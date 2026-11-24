import Queue from "bull";
import { sendMessageWithRetry } from "./sendHelper.mjs";
import { client, isClientReady } from "../whatsappClient.mjs";
import logger from "../logger.mjs";
import { saveScheduledMessage, updateMessageStatus, claimScheduledMessage, markEnqueueUnknown } from "./dbHelper.mjs";
import { deserializeScheduledContent, serializeScheduledContent } from "./scheduledContent.mjs";
import { queueConfig } from "../config.mjs";
import { HttpStatusCodes } from "../errors/AppError.mjs";

const useRedis = queueConfig.connection === "redis";
const queueOptions = useRedis ? {
  redis: {
    host: queueConfig.redis.host,
    port: queueConfig.redis.port,
    ...(queueConfig.redis.user && { username: queueConfig.redis.user }),
    ...(queueConfig.redis.password && { password: queueConfig.redis.password }),
    maxRetriesPerRequest: 1,
  },
} : {};

const messageQueue = useRedis ? new Queue("messageQueue", queueOptions) : null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForClientReady() {
  if (isClientReady()) return Promise.resolve();
  return new Promise((resolve) => {
    const onReady = () => {
      if (!isClientReady()) return;
      client.removeListener("ready", onReady);
      resolve();
    };
    client.on("ready", onReady);
    if (isClientReady()) onReady();
  });
}

function getAdditionalDelayMs() {
  const type = process.env.MESSAGE_DELAY_TYPE || "fixed";
  const delaySetting = process.env.MESSAGE_DELAY || "0";
  if (type === "random") {
    const [minStr, maxStr] = delaySetting.split(",");
    const min = Number(minStr.trim()) * 1000;
    const max = Number(maxStr.trim()) * 1000;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  return Number(delaySetting) * 1000;
}

if (useRedis) {
  messageQueue.process(async (job) => {
    const { chatId, content, options, scheduledMessageId, serializedContent } = job.data;
    let claimed = false;
    try {
      const additionalDelay = getAdditionalDelayMs();
      logger.info(`Applying additional delay of ${additionalDelay} ms before sending message to ${chatId}`);
      await sleep(additionalDelay);
      while (!isClientReady()) await waitForClientReady();
      if (scheduledMessageId) {
        claimed = await claimScheduledMessage(scheduledMessageId);
        if (!claimed) return;
      }
      const value = serializedContent ? deserializeScheduledContent(serializedContent) :
        content && typeof content === "object" ? deserializeScheduledContent(JSON.stringify(content)) : content;
      await sendMessageWithRetry(chatId, value, options);
      if (scheduledMessageId) await updateMessageStatus(scheduledMessageId, "sent");
      logger.info(`Message sent to ${chatId} from Redis queue`);
    } catch (error) {
      if (claimed) {
        job.discard();
        const status = error.statusCode === HttpStatusCodes.REQUEST_TIMEOUT ? "unknown" : "failed";
        await updateMessageStatus(scheduledMessageId, status);
      }
      logger.error({ error, chatId }, "Queue send failed");
      throw error;
    }
  });

  messageQueue.on("error", (error) => logger.error({ error }, "Redis queue error"));
  messageQueue.on("failed", (job, err) => {
    logger.error(`Job failed for ${job?.data?.chatId ?? "unknown"}: ${err.message}`);
  });
}

export async function addMessageToQueue(chatId, content, options, delay) {
  const scheduledMessageId = await saveScheduledMessage(
    chatId,
    content,
    options,
    delay
  );

  if (useRedis) {
    try {
      await messageQueue.add(
        { chatId, serializedContent: serializeScheduledContent(content), options, scheduledMessageId },
        { delay, attempts: 3, backoff: 5000, jobId: scheduledMessageId }
      );
    } catch (error) {
      // An enqueue failure can be ambiguous; do not permit an automatic SQLite send.
      await markEnqueueUnknown(scheduledMessageId);
      throw error;
    }
  } else {
    logger.info(`Message scheduled for ${chatId} in ${delay} ms`);
  }
}
