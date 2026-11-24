import { serve } from "@upstash/workflow";
import { claimScheduledMessage, getMessageById, updateMessageStatus, deleteCompletedMessagesBefore } from "../helpers/redisHelper.mjs";
import { sendMessageWithRetry } from "../helpers/sendHelper.mjs";
import { isClientReady } from "../whatsappClient.mjs";
import { HttpStatusCodes } from "../errors/AppError.mjs";
import logger from "../logger.mjs";

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function deliverScheduledMessage(messageId) {
  if (typeof messageId !== "string" || !idPattern.test(messageId)) throw new Error("Invalid message ID");
  // Fail before claiming so QStash can retry once the client is ready.
  if (!isClientReady()) throw new Error("WhatsApp client is not ready");
  if (!await claimScheduledMessage(messageId)) return { messageId, status: "skipped" };
  const message = await getMessageById(messageId);
  if (!message) return { messageId, status: "unknown" };
  try {
    await sendMessageWithRetry(message.chatId, message.content, message.options);
  } catch (error) {
    const status = error?.statusCode === HttpStatusCodes.REQUEST_TIMEOUT ? "unknown" : "failed";
    try { await updateMessageStatus(messageId, status, { expectedStatus: "processing" }); }
    catch (statusError) { logger.error({ messageId, error: statusError }, "Failed to record workflow outcome"); }
    return { messageId, status };
  }
  try {
    await updateMessageStatus(messageId, "sent", { expectedStatus: "processing" });
    return { messageId, status: "sent" };
  } catch (error) {
    // Delivery may have happened; leave processing for operator review, never resend.
    logger.error({ messageId, error }, "Message sent but Redis status update failed");
    return { messageId, status: "unknown" };
  }
}

const messageRoute = async (context) => {
  const { messageId } = context.requestPayload || {};
  return context.run("send-message", () => deliverScheduledMessage(messageId));
};

const batchRoute = async (context) => {
  const { messageIds, batchId, delayBetween = 1000 } = context.requestPayload || {};
  if (!Array.isArray(messageIds) || messageIds.length > 50 || messageIds.some((id) => typeof id !== "string" || !idPattern.test(id))) throw new Error("Invalid batch message IDs");
  if (!Number.isFinite(delayBetween) || delayBetween < 0) throw new Error("Invalid batch delay");
  const results = [];
  for (let index = 0; index < messageIds.length; index++) {
    if (index > 0 && delayBetween > 0) await context.sleep(`delay-${index}`, `${Math.ceil(delayBetween / 1000)}s`);
    results.push(await context.run(`send-message-${index}`, () => deliverScheduledMessage(messageIds[index])));
  }
  return { batchId, results };
};

const cleanupRoute = async (context) => {
  const { olderThanDays = 30 } = context.requestPayload || {};
  if (!Number.isFinite(olderThanDays) || olderThanDays < 1) throw new Error("Invalid cleanup age");
  return context.run("cleanup-messages", () => deleteCompletedMessagesBefore(Date.now() - olderThanDays * 86400000));
};

export const messageWorkflow = serve(messageRoute).handler;
export const batchMessageWorkflow = serve(batchRoute).handler;
export const cleanupWorkflow = serve(cleanupRoute).handler;
