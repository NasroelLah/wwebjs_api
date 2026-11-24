/* global process */
import { randomUUID } from "crypto";
import { Redis } from "@upstash/redis";
import logger from "../logger.mjs";
import { AppError, ErrorTypes, HttpStatusCodes } from "../errors/AppError.mjs";

class RedisManager {
  constructor() {
    this.client = null;
    this.isConnected = false;
  }

  getClient() {
    if (!this.client) {
      try {
        this.client = new Redis({
          url: process.env.UPSTASH_REDIS_REST_URL,
          token: process.env.UPSTASH_REDIS_REST_TOKEN,
        });
        this.isConnected = true;
        logger.info('Connected to Upstash Redis successfully');
      } catch (error) {
        logger.error({ error }, 'Failed to initialize Redis client');
        throw new AppError(
          ErrorTypes.DATABASE_ERROR,
          HttpStatusCodes.INTERNAL_SERVER_ERROR,
          'Redis client initialization failed',
          true
        );
      }
    }
    return this.client;
  }

  async healthCheck() {
    try {
      const client = this.getClient();
      await client.ping();
      return true;
    } catch (error) {
      logger.error({ error }, 'Redis health check failed');
      return false;
    }
  }

  generateId() {
    return randomUUID();
  }
}

// Singleton instance
const redisManager = new RedisManager();

/**
 * Save a scheduled message to Redis
 * @param {string} chatId - Chat ID for the message
 * @param {Object} content - Message content
 * @param {Object} options - Message options
 * @param {number} delay - Delay in milliseconds
 * @returns {string} - Generated message ID
 */
export async function saveScheduledMessage(chatId, content, options, delay) {
  try {
    const client = redisManager.getClient();
    const messageId = redisManager.generateId();
    const scheduledTime = Date.now() + delay;

    const messageData = {
      chatId,
      content: JSON.stringify(content),
      options: JSON.stringify(options),
      scheduledTime: scheduledTime.toString(),
      status: "scheduled",
      createdAt: Date.now().toString(),
      updatedAt: Date.now().toString(),
    };

    await Promise.all([
      client.hset(`scheduled:${messageId}`, messageData),
      client.zadd('scheduled:by-time', scheduledTime, messageId),
      client.sadd('scheduled:status:scheduled', messageId)
    ]);

    logger.info(`Scheduled message saved to Redis for chatId ${chatId}, messageId: ${messageId}`);
    return messageId;
  } catch (error) {
    logger.error({ error, chatId }, 'Failed to save scheduled message');
    throw new AppError(
      ErrorTypes.DATABASE_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      'Failed to save scheduled message',
      true
    );
  }
}

function parseMessageData(id, messageData) {
  return {
    id,
    chatId: messageData.chatId,
    content: JSON.parse(messageData.content || '{}'),
    options: JSON.parse(messageData.options || '{}'),
    scheduledTime: new Date(parseInt(messageData.scheduledTime)),
    status: messageData.status,
    createdAt: new Date(parseInt(messageData.createdAt)),
    updatedAt: new Date(parseInt(messageData.updatedAt)),
  };
}

/**
 * List messages by status for admin monitoring
 * @param {Object} filters
 * @param {string} filters.status
 * @param {number} filters.limit
 * @param {number} filters.offset
 * @returns {Object}
 */
export async function listMessagesByStatus({ status = 'scheduled', limit = 50, offset = 0 } = {}) {
  try {
    const client = redisManager.getClient();
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    const messageIds = await client.smembers(`scheduled:status:${status}`);
    const pagedIds = messageIds.slice(safeOffset, safeOffset + safeLimit);

    const messages = await Promise.all(
      pagedIds.map(async (messageId) => {
        const messageData = await client.hgetall(`scheduled:${messageId}`);
        if (!messageData || Object.keys(messageData).length === 0) return null;
        return parseMessageData(messageId, messageData);
      })
    );

    return {
      status,
      total: messageIds.length,
      limit: safeLimit,
      offset: safeOffset,
      items: messages.filter(Boolean)
    };
  } catch (error) {
    logger.error({ error, status }, 'Failed to list messages by status');
    throw new AppError(
      ErrorTypes.DATABASE_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      'Failed to list scheduled messages',
      true
    );
  }
}

/**
 * Get message counts grouped by status
 * @returns {Object}
 */
export async function getMessageStatusSummary() {
  try {
    const client = redisManager.getClient();
    const [scheduled, sent, failed] = await Promise.all([
      client.scard('scheduled:status:scheduled'),
      client.scard('scheduled:status:sent'),
      client.scard('scheduled:status:failed')
    ]);

    return { scheduled, sent, failed };
  } catch (error) {
    logger.error({ error }, 'Failed to get message status summary');
    throw new AppError(
      ErrorTypes.DATABASE_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      'Failed to retrieve message status summary',
      true
    );
  }
}

/**
 * Get scheduled messages that are ready to be sent
 * @returns {Array} - Array of scheduled messages
 */
export async function getScheduledMessages() {
  try {
    const client = redisManager.getClient();
    const currentTime = Date.now();

    // Get message IDs that are scheduled and due
    const messageIds = await client.zrangebyscore(
      'scheduled:by-time',
      '-inf',
      currentTime.toString()
    );

    if (messageIds.length === 0) {
      return [];
    }

    // Get message data for each ID
    const messages = await Promise.all(
      messageIds.map(async (messageId) => {
        const messageData = await client.hgetall(`scheduled:${messageId}`);
        if (messageData && messageData.status === 'scheduled') {
          return parseMessageData(messageId, messageData);
        }
        return null;
      })
    );

    // Filter out null values
    return messages.filter(message => message !== null);
  } catch (error) {
    logger.error({ error }, 'Failed to get scheduled messages');
    throw new AppError(
      ErrorTypes.DATABASE_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      'Failed to retrieve scheduled messages',
      true
    );
  }
}

/**
 * Update message status
 * @param {string} id - Message ID
 * @param {string} status - New status
 */
export async function updateMessageStatus(id, status) {
  try {
    const client = redisManager.getClient();

    // Get current message data
    const messageData = await client.hgetall(`scheduled:${id}`);
    if (!messageData || Object.keys(messageData).length === 0) {
      throw new AppError(
        ErrorTypes.DATABASE_ERROR,
        HttpStatusCodes.NOT_FOUND,
        `Message with id ${id} not found`,
        true
      );
    }

    const oldStatus = messageData.status;

    await Promise.all([
      client.hset(`scheduled:${id}`, {
        status,
        updatedAt: Date.now().toString()
      }),
      client.srem(`scheduled:status:${oldStatus}`, id),
      client.sadd(`scheduled:status:${status}`, id),
      status !== 'scheduled'
        ? client.zrem('scheduled:by-time', id)
        : Promise.resolve(),
      ['sent', 'failed'].includes(status)
        ? client.zadd('scheduled:completed-by-time', Date.now(), id)
        : client.zrem('scheduled:completed-by-time', id)
    ]);

    logger.info(`Message status updated to ${status} for id ${id}`);
  } catch (error) {
    if (error instanceof AppError) throw error;

    logger.error({ error, id, status }, 'Failed to update message status');
    throw new AppError(
      ErrorTypes.DATABASE_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      'Failed to update message status',
      true
    );
  }
}

/**
 * Get message by ID
 * @param {string} id - Message ID
 * @returns {Object|null} - Message data or null if not found
 */
export async function getMessageById(id) {
  try {
    const client = redisManager.getClient();
    const messageData = await client.hgetall(`scheduled:${id}`);

    if (!messageData || Object.keys(messageData).length === 0) {
      return null;
    }

    return parseMessageData(id, messageData);
  } catch (error) {
    logger.error({ error, id }, 'Failed to get message by ID');
    throw new AppError(
      ErrorTypes.DATABASE_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      'Failed to retrieve message',
      true
    );
  }
}

/**
 * Delete message by ID
 * @param {string} id - Message ID
 */
export async function deleteMessage(id) {
  try {
    const client = redisManager.getClient();

    // Get message data to know the status
    const messageData = await client.hgetall(`scheduled:${id}`);
    if (messageData && Object.keys(messageData).length > 0) {
      const status = messageData.status;

      // Remove from all sets and sorted sets
      await Promise.all([
        client.del(`scheduled:${id}`),
        client.zrem('scheduled:by-time', id),
        client.zrem('scheduled:completed-by-time', id),
        client.srem(`scheduled:status:${status}`, id)
      ]);

      logger.info(`Message ${id} deleted from Redis`);
    }
  } catch (error) {
    logger.error({ error, id }, 'Failed to delete message');
    throw new AppError(
      ErrorTypes.DATABASE_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      'Failed to delete message',
      true
    );
  }
}

export { redisManager };