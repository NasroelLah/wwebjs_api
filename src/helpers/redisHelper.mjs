import { randomUUID } from "crypto";
import { Redis } from "@upstash/redis";
import logger from "../logger.mjs";
import { AppError, ErrorTypes, HttpStatusCodes } from "../errors/AppError.mjs";
import { serializeScheduledContent, deserializeScheduledContent } from "./scheduledContent.mjs";

export const MESSAGE_STATUSES = Object.freeze([
  "scheduled",
  "processing",
  "sent",
  "failed",
  "unknown",
  "enqueue_unknown",
  "cancelled",
]);

// Messages in these states are indexed in scheduled:completed-by-time for cleanup.
const COMPLETED_STATUSES = Object.freeze(["sent", "failed", "cancelled"]);

// Status transitions that cannot cause a second WhatsApp send. Nothing transitions back to
// "scheduled", and "processing" is only entered through claimScheduledMessage.
// "unknown" and "enqueue_unknown" are never resent automatically; an operator must resolve them.
export const ALLOWED_STATUS_TRANSITIONS = Object.freeze({
  scheduled: Object.freeze(["cancelled", "failed", "enqueue_unknown"]),
  processing: Object.freeze(["sent", "failed", "unknown"]),
  enqueue_unknown: Object.freeze(["sent", "failed", "cancelled"]),
  unknown: Object.freeze(["sent", "failed", "cancelled"]),
  sent: Object.freeze([]),
  failed: Object.freeze([]),
  cancelled: Object.freeze([]),
});

// Key layout (preserved from the PR):
//   scheduled:<id>                 hash   chatId, content, options, scheduledTime, status, createdAt, updatedAt
//   scheduled:by-time              zset   id -> scheduledTime, members are status "scheduled" only
//   scheduled:status:<status>      set    ids currently in that status
//   scheduled:completed-by-time    zset   id -> completion time, members are sent/failed/cancelled
const RECORD_PREFIX = "scheduled:";
const STATUS_PREFIX = "scheduled:status:";
const BY_TIME_KEY = "scheduled:by-time";
const COMPLETED_KEY = "scheduled:completed-by-time";

const recordKey = (id) => `${RECORD_PREFIX}${id}`;
const statusKey = (status) => `${STATUS_PREFIX}${status}`;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidId = (id) => typeof id === "string" && UUID_PATTERN.test(id);

const luaSet = (values) => `{${values.map((value) => `["${value}"]=true`).join(", ")}}`;
const LUA_TRANSITIONS = `{${Object.entries(ALLOWED_STATUS_TRANSITIONS)
  .map(([from, targets]) => `["${from}"]=${luaSet(targets)}`)
  .join(", ")}}`;
const LUA_COMPLETED = luaSet(COMPLETED_STATUSES);

// All multi-key mutations run as single Lua scripts so that status checks, status-set moves
// and index updates are one atomic step on the server.

// KEYS: record, by-time, status:scheduled | ARGV: id, scheduledTime, field, value, ...
const CREATE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
redis.call('HSET', KEYS[1], unpack(ARGV, 3))
redis.call('ZADD', KEYS[2], ARGV[2], ARGV[1])
redis.call('SADD', KEYS[3], ARGV[1])
return 1
`;

// KEYS: record, status:scheduled, status:processing, by-time | ARGV: id, now
// Returns 1 only for the single caller that moves the record from scheduled to processing.
const CLAIM_SCRIPT = `
local cur = redis.call('HGET', KEYS[1], 'status')
if cur ~= 'scheduled' then return 0 end
redis.call('HSET', KEYS[1], 'status', 'processing', 'updatedAt', ARGV[2])
redis.call('SREM', KEYS[2], ARGV[1])
redis.call('SADD', KEYS[3], ARGV[1])
redis.call('ZREM', KEYS[4], ARGV[1])
return 1
`;

// KEYS: record, by-time, completed-by-time | ARGV: id, target, now, expectedStatus or '', status prefix
// Returns OK, NOT_FOUND, STATUS_CONFLICT:<current>, or INVALID_TRANSITION:<current>.
const TRANSITION_SCRIPT = `
local transitions = ${LUA_TRANSITIONS}
local completed = ${LUA_COMPLETED}
local cur = redis.call('HGET', KEYS[1], 'status')
if not cur then return 'NOT_FOUND' end
local expected = ARGV[4]
if expected ~= '' and cur ~= expected then return 'STATUS_CONFLICT:' .. cur end
local targets = transitions[cur]
if not targets or not targets[ARGV[2]] then return 'INVALID_TRANSITION:' .. cur end
redis.call('HSET', KEYS[1], 'status', ARGV[2], 'updatedAt', ARGV[3])
redis.call('SREM', ARGV[5] .. cur, ARGV[1])
redis.call('SADD', ARGV[5] .. ARGV[2], ARGV[1])
redis.call('ZREM', KEYS[2], ARGV[1])
if completed[ARGV[2]] then
  redis.call('ZADD', KEYS[3], ARGV[3], ARGV[1])
else
  redis.call('ZREM', KEYS[3], ARGV[1])
end
return 'OK'
`;

// KEYS: record, by-time, completed-by-time | ARGV: id, status prefix
// Deletable: scheduled (not yet claimed), cancelled, sent, failed. Anything else (processing,
// unknown, enqueue_unknown) is refused so an in-flight or ambiguous send is never erased.
// Returns OK, NOT_FOUND, or STATUS_CONFLICT:<current>. Runs atomically with CLAIM_SCRIPT, so a
// delayed workflow that claims after deletion finds no record and gets 0.
const DELETE_SCRIPT = `
local cur = redis.call('HGET', KEYS[1], 'status')
if not cur then return 'NOT_FOUND' end
local deletable = {scheduled=true, cancelled=true, sent=true, failed=true}
if not deletable[cur] then return 'STATUS_CONFLICT:' .. cur end
redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('ZREM', KEYS[3], ARGV[1])
redis.call('SREM', ARGV[2] .. cur, ARGV[1])
return 'OK'
`;

// KEYS: one status set per status (in MESSAGE_STATUSES order) | returns their cardinalities atomically.
const STATUS_SUMMARY_SCRIPT = `
local out = {}
for i = 1, #KEYS do out[i] = redis.call('SCARD', KEYS[i]) end
return out
`;

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(Math.trunc(number), min), max);
}

function assertStatus(status, field = "status") {
  if (!MESSAGE_STATUSES.includes(status)) {
    throw new AppError(
      ErrorTypes.VALIDATION_ERROR,
      HttpStatusCodes.UNPROCESSABLE_ENTITY,
      `Invalid ${field}: ${status}`,
      true
    );
  }
}

function notFound(id) {
  return new AppError(
    ErrorTypes.DATABASE_ERROR,
    HttpStatusCodes.NOT_FOUND,
    `Message with id ${id} not found`,
    true
  );
}

// Converts unexpected SDK/network errors into the module's AppError. Only ids and error messages
// are logged; message content, options and credentials never reach the logger.
function storageError(error, message, messageId) {
  if (error instanceof AppError) return error;
  logger.error({ messageId, reason: error?.message }, message);
  return new AppError(ErrorTypes.DATABASE_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, message, true);
}

class RedisManager {
  constructor() {
    this.client = null;
  }

  getClient() {
    if (this.client) return this.client;

    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
      throw new AppError(
        ErrorTypes.CONFIGURATION_ERROR,
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        "Upstash Redis is not configured",
        true
      );
    }

    // The SDK's automatic JSON deserialization would turn stored strings such as chat IDs or
    // "123" timestamps into numbers and objects. Raw replies are parsed explicitly instead.
    this.client = new Redis({ url, token, automaticDeserialization: false });
    logger.info("Upstash Redis client initialized");
    return this.client;
  }

  async healthCheck() {
    try {
      await this.getClient().ping();
      return true;
    } catch (error) {
      logger.error({ reason: error?.message }, "Redis health check failed");
      return false;
    }
  }

  generateId() {
    return randomUUID();
  }
}

const redisManager = new RedisManager();

// With automaticDeserialization disabled, HGETALL returns a flat [field, value, ...] array
// (or [] when missing). Accept a plain object too so either SDK behaviour is handled.
function toRecord(raw) {
  if (!raw) return null;
  let entries;
  if (Array.isArray(raw)) {
    entries = [];
    for (let i = 0; i < raw.length; i += 2) entries.push([raw[i], raw[i + 1]]);
  } else {
    entries = Object.entries(raw);
  }
  if (entries.length === 0) return null;
  return Object.fromEntries(entries.map(([key, value]) => [String(key), value === null || value === undefined ? "" : String(value)]));
}

// Accepts the envelope written by serializeScheduledContent and legacy PR values, which stored
// JSON.stringify(content) without an envelope (plain text as a JSON string, media/location as objects).
function decodeContent(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const restored = deserializeScheduledContent(raw);
  if (restored !== raw) return restored;
  try {
    const legacy = JSON.parse(raw);
    return typeof legacy === "string" ? legacy : raw;
  } catch {
    return raw;
  }
}

/**
 * Converts a stored hash (string fields) into the message shape used by callers and the admin API.
 * @param {string} id
 * @param {Record<string, string>} record
 */
export function parseStoredMessage(id, record) {
  return {
    id,
    _id: id,
    chatId: record.chatId,
    content: decodeContent(record.content),
    options: record.options ? JSON.parse(record.options) : {},
    scheduledTime: new Date(Number(record.scheduledTime)),
    status: record.status,
    createdAt: new Date(Number(record.createdAt)),
    updatedAt: new Date(Number(record.updatedAt)),
  };
}

async function loadMessages(client, ids) {
  const loaded = await Promise.all(
    ids.map(async (id) => {
      const record = toRecord(await client.hgetall(recordKey(id)));
      if (!record) return null;
      try {
        return parseStoredMessage(id, record);
      } catch (error) {
        logger.warn({ messageId: id, reason: error?.message }, "Skipping unreadable scheduled message");
        return null;
      }
    })
  );
  return loaded.filter(Boolean);
}

function assertTransitionResult(id, target, result) {
  if (result === "OK") return;
  if (result === "NOT_FOUND") throw notFound(id);

  const [code, current] = result.split(":");
  if (code === "STATUS_CONFLICT") {
    throw new AppError(
      ErrorTypes.DATABASE_ERROR,
      HttpStatusCodes.CONFLICT,
      `Message ${id} is ${current}, not the expected status`,
      true
    );
  }
  if (code === "INVALID_TRANSITION") {
    throw new AppError(
      ErrorTypes.DATABASE_ERROR,
      HttpStatusCodes.CONFLICT,
      `Cannot change message ${id} from ${current} to ${target}`,
      true
    );
  }
  throw new AppError(
    ErrorTypes.DATABASE_ERROR,
    HttpStatusCodes.INTERNAL_SERVER_ERROR,
    "Unexpected status update result",
    true
  );
}

/**
 * Save a scheduled message to Redis. Content is encoded with serializeScheduledContent.
 * @param {string} chatId - Chat ID for the message
 * @param {string|MessageMedia|Location} content - Message content
 * @param {Object} options - Message options
 * @param {number} delay - Delay in milliseconds
 * @returns {Promise<string>} - Generated message ID
 */
export async function saveScheduledMessage(chatId, content, options, delay) {
  if (!chatId) {
    throw new AppError(ErrorTypes.VALIDATION_ERROR, HttpStatusCodes.BAD_REQUEST, "chatId is required", true);
  }

  let encodedContent;
  try {
    encodedContent = serializeScheduledContent(content);
  } catch {
    throw new AppError(
      ErrorTypes.VALIDATION_ERROR,
      HttpStatusCodes.UNPROCESSABLE_ENTITY,
      "Unsupported scheduled message content",
      true
    );
  }

  const id = redisManager.generateId();
  const now = Date.now();
  const scheduledTime = now + Math.max(0, Number(delay) || 0);

  try {
    const client = redisManager.getClient();
    const created = await client.eval(
      CREATE_SCRIPT,
      [recordKey(id), BY_TIME_KEY, statusKey("scheduled")],
      [
        id,
        String(scheduledTime),
        "chatId", String(chatId),
        "content", encodedContent,
        "options", JSON.stringify(options ?? {}),
        "scheduledTime", String(scheduledTime),
        "status", "scheduled",
        "createdAt", String(now),
        "updatedAt", String(now),
      ]
    );
    if (Number(created) !== 1) {
      throw new Error("Generated message id already exists");
    }
  } catch (error) {
    throw storageError(error, "Failed to save scheduled message", id);
  }

  logger.info({ messageId: id, scheduledTime }, "Scheduled message saved to Redis");
  return id;
}

/**
 * Messages whose scheduled time has passed and which are still in status "scheduled".
 * Callers must still call claimScheduledMessage before sending.
 * @returns {Promise<Array<Object>>}
 */
export async function getScheduledMessages() {
  try {
    const client = redisManager.getClient();
    const ids = await client.zrange(BY_TIME_KEY, "-inf", Date.now(), { byScore: true });
    const messages = await loadMessages(client, ids);
    return messages.filter((message) => message.status === "scheduled");
  } catch (error) {
    throw storageError(error, "Failed to retrieve scheduled messages");
  }
}

/**
 * Paginated listing for admin monitoring. "scheduled" is ordered by due time; other statuses are
 * ordered by id. Non-scheduled listings load the status set, so they are O(n) per request.
 * @returns {Promise<{status: string, total: number, limit: number, offset: number, items: Array<Object>}>}
 */
export async function listMessagesByStatus({ status = "scheduled", limit = 50, offset = 0 } = {}) {
  assertStatus(status);
  const safeLimit = clampInteger(limit, 1, 100, 50);
  const safeOffset = clampInteger(offset, 0, Number.MAX_SAFE_INTEGER, 0);

  try {
    const client = redisManager.getClient();
    const total = Number(await client.scard(statusKey(status)));

    let ids;
    if (status === "scheduled") {
      ids = await client.zrange(BY_TIME_KEY, safeOffset, safeOffset + safeLimit - 1);
    } else {
      const members = await client.smembers(statusKey(status));
      ids = members.sort().slice(safeOffset, safeOffset + safeLimit);
    }

    const items = await loadMessages(client, ids);
    return { status, total, limit: safeLimit, offset: safeOffset, items };
  } catch (error) {
    throw storageError(error, "Failed to list scheduled messages");
  }
}

/**
 * Counts for every status, read atomically. Statuses with no messages report 0.
 * @returns {Promise<Record<string, number>>}
 */
export async function getMessageStatusSummary() {
  try {
    const client = redisManager.getClient();
    const counts = await client.eval(
      STATUS_SUMMARY_SCRIPT,
      MESSAGE_STATUSES.map((status) => statusKey(status)),
      []
    );
    return Object.fromEntries(MESSAGE_STATUSES.map((status, index) => [status, Number(counts[index]) || 0]));
  } catch (error) {
    throw storageError(error, "Failed to retrieve message status summary");
  }
}

/**
 * @returns {Promise<Object|null>} message, or null when missing
 */
export async function getMessageById(id) {
  if (!isValidId(id)) return null;
  try {
    const client = redisManager.getClient();
    const record = toRecord(await client.hgetall(recordKey(id)));
    return record ? parseStoredMessage(id, record) : null;
  } catch (error) {
    throw storageError(error, "Failed to retrieve message", id);
  }
}

/**
 * Atomically claims a scheduled message for sending. Exactly one concurrent caller gets true.
 * A false result means the message is missing or no longer scheduled, so the caller must not send.
 * Any error means the caller must not send either.
 * @returns {Promise<boolean>}
 */
export async function claimScheduledMessage(id) {
  if (!isValidId(id)) return false;
  try {
    const client = redisManager.getClient();
    const claimed = await client.eval(
      CLAIM_SCRIPT,
      [recordKey(id), statusKey("scheduled"), statusKey("processing"), BY_TIME_KEY],
      [id, String(Date.now())]
    );
    return Number(claimed) === 1;
  } catch (error) {
    throw storageError(error, "Failed to claim scheduled message", id);
  }
}

/**
 * Records that the enqueue step failed ambiguously, so the message is never resent automatically.
 * Allowed only from "scheduled"; do not overwrite a concurrent worker claim.
 * @returns {Promise<boolean>}
 */
export async function markEnqueueUnknown(id) {
  if (!isValidId(id)) return false;
  try {
    const client = redisManager.getClient();
    const result = String(
      await client.eval(
        TRANSITION_SCRIPT,
        [recordKey(id), BY_TIME_KEY, COMPLETED_KEY],
        [id, "enqueue_unknown", String(Date.now()), "scheduled", STATUS_PREFIX]
      )
    );
    if (result !== "OK") {
      logger.warn({ messageId: id, result: result.split(":")[0] }, "Message could not be marked enqueue_unknown");
      return false;
    }
    return true;
  } catch (error) {
    throw storageError(error, "Failed to mark message enqueue_unknown", id);
  }
}

/**
 * Changes a message's status, validated atomically against ALLOWED_STATUS_TRANSITIONS.
 * Pass expectedStatus for compare-and-set: the update is rejected with 409 when the current
 * status differs, so admin overrides cannot race with worker claims.
 * @param {string} id
 * @param {string} status
 * @param {{expectedStatus?: string}} [options]
 */
export async function updateMessageStatus(id, status, options = {}) {
  assertStatus(status);
  const expectedStatus = options?.expectedStatus;
  if (expectedStatus !== undefined && expectedStatus !== null) {
    assertStatus(expectedStatus, "expectedStatus");
  }
  if (!isValidId(id)) throw notFound(id);

  let result;
  try {
    const client = redisManager.getClient();
    result = String(
      await client.eval(
        TRANSITION_SCRIPT,
        [recordKey(id), BY_TIME_KEY, COMPLETED_KEY],
        [id, status, String(Date.now()), expectedStatus ?? "", STATUS_PREFIX]
      )
    );
  } catch (error) {
    throw storageError(error, "Failed to update message status", id);
  }

  assertTransitionResult(id, status, result);
  logger.info({ messageId: id, status }, "Message status updated");
}

/**
 * Deletes a message. Only scheduled, cancelled, sent and failed messages can be deleted; processing,
 * unknown and enqueue_unknown are refused with 409. A delayed workflow that claims after deletion gets false.
 */
export async function deleteMessage(id) {
  if (!isValidId(id)) throw notFound(id);

  let result;
  try {
    const client = redisManager.getClient();
    result = String(
      await client.eval(
        DELETE_SCRIPT,
        [recordKey(id), BY_TIME_KEY, COMPLETED_KEY],
        [id, STATUS_PREFIX]
      )
    );
  } catch (error) {
    throw storageError(error, "Failed to delete message", id);
  }

  if (result === "NOT_FOUND") throw notFound(id);
  if (result.startsWith("STATUS_CONFLICT:")) {
    const current = result.slice("STATUS_CONFLICT:".length);
    throw new AppError(
      ErrorTypes.DATABASE_ERROR,
      HttpStatusCodes.CONFLICT,
      `Message ${id} is ${current} and cannot be deleted`,
      true
    );
  }
  logger.info({ messageId: id }, "Message deleted from Redis");
}

/**
 * Cleanup for the completed index: deletes up to `limit` sent/failed/cancelled messages that
 * completed at or before cutoffMs.
 * @param {number} cutoffMs - epoch milliseconds
 * @param {number} [limit=100]
 * @returns {Promise<{scanned: number, deleted: number}>}
 */
export async function deleteCompletedMessagesBefore(cutoffMs, limit = 100) {
  const cutoff = Number(cutoffMs);
  if (!Number.isFinite(cutoff)) {
    throw new AppError(ErrorTypes.VALIDATION_ERROR, HttpStatusCodes.BAD_REQUEST, "cutoffMs must be a number", true);
  }
  const safeLimit = clampInteger(limit, 1, 1000, 100);

  try {
    const client = redisManager.getClient();
    const ids = await client.zrange(COMPLETED_KEY, "-inf", cutoff, { byScore: true, offset: 0, count: safeLimit });

    let deleted = 0;
    for (const id of ids) {
      const result = String(
        await client.eval(DELETE_SCRIPT, [recordKey(id), BY_TIME_KEY, COMPLETED_KEY], [id, STATUS_PREFIX])
      );
      if (result === "OK") deleted += 1;
    }
    if (deleted > 0) logger.info({ deleted }, "Completed scheduled messages cleaned up");
    return { scanned: ids.length, deleted };
  } catch (error) {
    throw storageError(error, "Failed to clean up completed scheduled messages");
  }
}

export { redisManager };
