import { workflowManager } from "./workflowHelper.mjs";
import logger from "../logger.mjs";
import { messageConfig } from "../config.mjs";

function getAdditionalDelayMs() {
  const type = messageConfig.delayType;
  const delaySetting = messageConfig.delay;

  if (type === "random") {
    const [minStr, maxStr] = delaySetting.toString().split(",");
    const min = Number(minStr.trim()) * 1000;
    const max = Number(maxStr.trim()) * 1000;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  return Number(delaySetting) * 1000;
}

/**
 * Add message to queue using Upstash Workflow
 * @param {string} chatId - Target chat ID
 * @param {Object} content - Message content
 * @param {Object} options - Message options
 * @param {number} delay - Delay in milliseconds
 * @returns {string} - Message ID
 */
export async function addMessageToQueue(chatId, content, options, delay) {
  try {
    // Add additional delay based on configuration
    const additionalDelay = getAdditionalDelayMs();
    const totalDelay = delay + additionalDelay;

    logger.info(
      `Scheduling message for ${chatId} with delay ${totalDelay}ms (original: ${delay}ms, additional: ${additionalDelay}ms)`
    );

    // Use workflow manager to schedule the message
    const messageId = await workflowManager.scheduleMessage(chatId, content, options, totalDelay);

    logger.info(`Message queued successfully for ${chatId}, messageId: ${messageId}`);
    return messageId;
  } catch (error) {
    logger.error({ error, chatId }, 'Failed to add message to queue');
    throw error;
  }
}

/**
 * Add multiple messages as a batch
 * @param {Array} messages - Array of message objects
 * @param {number} delayBetween - Delay between messages in milliseconds
 * @returns {Object} - Batch result
 */
export async function addBatchMessagesToQueue(messages, delayBetween = 1000) {
  try {
    const additionalDelay = getAdditionalDelayMs();
    const totalDelayBetween = delayBetween + additionalDelay;

    logger.info(
      `Scheduling batch of ${messages.length} messages with ${totalDelayBetween}ms delay between messages`
    );

    // Use workflow manager to schedule the batch
    const result = await workflowManager.scheduleBatchMessages(messages, totalDelayBetween);

    logger.info(`Batch messages queued successfully. BatchId: ${result.batchId}, Messages: ${result.messageCount}`);
    return result;
  } catch (error) {
    logger.error({ error, messageCount: messages.length }, 'Failed to add batch messages to queue');
    throw error;
  }
}

/**
 * Legacy compatibility - kept for backward compatibility
 */
export { addMessageToQueue as addMessageToWorkflow };