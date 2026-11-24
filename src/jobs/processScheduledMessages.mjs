import {
  getScheduledMessages,
  claimScheduledMessage,
  updateMessageStatus,
} from "../helpers/dbHelper.mjs";
import { sendMessageWithRetry } from "../helpers/sendHelper.mjs";
import { isClientReady } from "../whatsappClient.mjs";
import { HttpStatusCodes } from "../errors/AppError.mjs";
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

let running = false;

export async function processScheduledMessages() {
  if (running || !isClientReady()) return;
  running = true;
  try {
    const messages = await getScheduledMessages();
    for (const msg of messages) {
      if (msg.scheduledTime > new Date() || !isClientReady()) continue;
      if (!await claimScheduledMessage(msg._id)) continue;
      try {
        const delayMs = getDelayMs();
        logger.info(`Delaying message to ${msg.chatId} for ${delayMs} ms`);
        await sleep(delayMs);
        await sendMessageWithRetry(msg.chatId, msg.content, msg.options || {});
      } catch (error) {
        // A timeout does not cancel WhatsApp's operation; never automatically resend it.
        const status = error.statusCode === HttpStatusCodes.REQUEST_TIMEOUT ? "unknown" : "failed";
        await updateMessageStatus(msg._id, status);
        logger.error({ error, id: msg._id, status }, "Scheduled message failed");
        continue;
      }
      try {
        await updateMessageStatus(msg._id, "sent");
        logger.info(`Scheduled message sent to ${msg.chatId}`);
      } catch (error) {
        // The message may have been delivered; leave the claim intact.
        logger.error({ error, id: msg._id }, "Message sent but status update failed");
      }
    }
  } finally {
    running = false;
  }
}

