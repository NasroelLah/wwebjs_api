import Queue from "bull";
import cron from "node-cron";
import { sendMessageWithRetry } from "./sendHelper.mjs";
import logger from "../logger.mjs";
import {
  saveScheduledMessage,
  getScheduledMessages,
  updateMessageStatus,
} from "./dbHelper.mjs";

const useRedis = process.env.QUEUE_CONNECTION === "redis";
const queueOptions = useRedis
  ? {
      redis: {
        host: process.env.REDIS_HOST || "127.0.0.1",
        port: process.env.REDIS_PORT || 6379,
      },
    }
  : {};

const messageQueue = new Queue("messageQueue", queueOptions);

messageQueue.process(async (job) => {
  const { chatId, content, options } = job.data;
  try {
    await sendMessageWithRetry(chatId, content, options);
    logger.info(`Message sent to ${chatId} from queue`);
  } catch (error) {
    logger.error(`Queue send failed: ${error.message}`);
    throw error;
  }
});

messageQueue.on("failed", (job, err) => {
  logger.error(`Job failed for chatId ${job.data.chatId}: ${err.message}`);
  // Optionally, you can implement further actions like notifying the user
});

export async function addMessageToQueue(chatId, content, options, delay) {
  if (useRedis) {
    messageQueue.add(
      { chatId, content, options },
      { delay, attempts: 3, backoff: 5000 }
    );
  } else {
    const scheduleTime = new Date(Date.now() + delay);
    const cronExpression = `${scheduleTime.getSeconds()} ${scheduleTime.getMinutes()} ${scheduleTime.getHours()} ${scheduleTime.getDate()} ${
      scheduleTime.getMonth() + 1
    } *`;
    cron.schedule(cronExpression, async () => {
      try {
        await sendMessageWithRetry(chatId, content, options);
        logger.info(`Message sent to ${chatId} from cron job`);
      } catch (error) {
        logger.error(`Cron job send failed: ${error.message}`);
        // Optionally, you can implement further actions like notifying the user
      }
    });
  }
  await saveScheduledMessage(chatId, content, options, delay);
}

export function processScheduledMessages() {
  cron.schedule("* * * * *", async () => {
    const messages = await getScheduledMessages();
    const now = new Date();
    for (const message of messages) {
      if (new Date(message.scheduledTime) <= now) {
        try {
          await sendMessageWithRetry(
            message.chatId,
            message.content,
            message.options
          );
          logger.info(`Scheduled message sent to ${message.chatId}`);
          // Update message status to 'sent' in MongoDB
          await updateMessageStatus(message._id, "sent");
        } catch (error) {
          logger.error(`Failed to send scheduled message: ${error.message}`);
        }
      }
    }
  });
}
