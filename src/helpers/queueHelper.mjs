/* global process */
import Queue from "bull";
import { sendMessageWithRetry } from "./sendHelper.mjs";
import logger from "../logger.mjs";
import { saveScheduledMessage, updateMessageStatus } from "./dbHelper.mjs";

const useRedis = process.env.QUEUE_CONNECTION === "redis";
const queueOptions = useRedis
  ? {
      redis: {
        host: process.env.REDIS_HOST || "127.0.0.1",
        port: process.env.REDIS_PORT || 6379,
      },
    }
  : {};

const messageQueue = useRedis ? new Queue("messageQueue", queueOptions) : null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    const { chatId, content, options, scheduledMessageId } = job.data;
    try {
      const additionalDelay = getAdditionalDelayMs();
      logger.info(
        `Applying additional delay of ${additionalDelay} ms before sending message to ${chatId}`
      );
      await sleep(additionalDelay);

      await sendMessageWithRetry(chatId, content, options);
      logger.info(`Message sent to ${chatId} from Redis queue`);
      if (scheduledMessageId)
        await updateMessageStatus(scheduledMessageId, "sent");
    } catch (error) {
      logger.error(`Queue send failed: ${error.message}`);
      throw error;
    }
  });

  messageQueue.on("failed", (job, err) => {
    logger.error(`Job failed for ${job.data.chatId}: ${err.message}`);
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
    messageQueue.add(
      { chatId, content, options, scheduledMessageId },
      { delay, attempts: 3, backoff: 5000 }
    );
  } else {
    logger.info(
      `Message scheduled for ${chatId} in ${delay} ms (Bree will process it)`
    );
  }
}
