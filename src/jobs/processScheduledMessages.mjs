import {
  getScheduledMessages,
  updateMessageStatus,
} from "../helpers/dbHelper.mjs";
import { sendMessageWithRetry } from "../helpers/sendHelper.mjs";
import logger from "../logger.mjs";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getDelayMs() {
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

async function processScheduledMessagesJob() {
  const messages = await getScheduledMessages();
  const now = new Date();
  await Promise.all(
    messages.map(async (msg) => {
      if (new Date(msg.scheduledTime) <= now) {
        try {
          const delayMs = getDelayMs();
          logger.info(`Delaying message to ${msg.chatId} for ${delayMs} ms`);
          await sleep(delayMs);
          await sendMessageWithRetry(msg.chatId, msg.content, msg.options);
          await updateMessageStatus(msg._id, "sent");
          logger.info(`Scheduled message sent to ${msg.chatId}`);
        } catch (error) {
          logger.error(`Error processing message ${msg._id}: ${error.message}`);
        }
      }
    })
  );
}

await processScheduledMessagesJob();
process.exit(0); // Ensure the worker exits after the job finishes
