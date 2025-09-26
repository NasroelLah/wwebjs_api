/* global process */
import { serve } from "@upstash/workflow";
import { sendMessageWithRetry } from "../helpers/sendHelper.mjs";
import { updateMessageStatus } from "../helpers/redisHelper.mjs";
import logger from "../logger.mjs";

/**
 * Message Workflow - Handles scheduled message sending with reliability
 * Payload structure: { chatId, content, options, messageId, delay }
 */
export const messageWorkflow = serve(async (context) => {
  const { chatId, content, options, messageId, delay = 0 } = context.requestPayload;

  logger.info(`Starting message workflow for chatId: ${chatId}, messageId: ${messageId}`);

  // Step 1: Sleep for the specified delay if needed
  if (delay > 0) {
    logger.info(`Workflow sleeping for ${delay}ms for messageId: ${messageId}`);
    await context.sleep(delay);
  }

  // Step 2: Send the message with automatic retries
  const messageResult = await context.run("send-message", async () => {
    try {
      logger.info(`Sending message to chatId: ${chatId}`);
      const result = await sendMessageWithRetry(chatId, content, options);
      logger.info(`Message sent successfully to chatId: ${chatId}, messageId: ${messageId}`);
      return result;
    } catch (error) {
      logger.error({ error, chatId, messageId }, `Failed to send message in workflow`);
      throw error;
    }
  });

  // Step 3: Update message status to 'sent'
  await context.run("update-status", async () => {
    try {
      if (messageId) {
        await updateMessageStatus(messageId, "sent");
        logger.info(`Message status updated to 'sent' for messageId: ${messageId}`);
      }
      return { status: "sent", timestamp: new Date().toISOString() };
    } catch (error) {
      logger.error({ error, messageId }, `Failed to update message status in workflow`);
      // Don't throw here - message was sent successfully, status update failure shouldn't fail the workflow
      return { status: "sent_status_update_failed", error: error.message };
    }
  });

  logger.info(`Message workflow completed successfully for chatId: ${chatId}, messageId: ${messageId}`);

  return {
    success: true,
    chatId,
    messageId,
    sentAt: new Date().toISOString(),
    messageResult
  };
});

/**
 * Batch Message Workflow - Handles multiple message sending in sequence
 * Payload structure: { messages: [{ chatId, content, options, messageId }], batchId }
 */
export const batchMessageWorkflow = serve(async (context) => {
  const { messages, batchId, delayBetween = 1000 } = context.requestPayload;

  logger.info(`Starting batch message workflow with ${messages.length} messages, batchId: ${batchId}`);

  const results = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const { chatId, content, options, messageId } = message;

    // Send each message as a separate step
    const result = await context.run(`send-message-${i}`, async () => {
      try {
        logger.info(`Sending batch message ${i + 1}/${messages.length} to chatId: ${chatId}`);
        const sendResult = await sendMessageWithRetry(chatId, content, options);

        // Update status if messageId is provided
        if (messageId) {
          await updateMessageStatus(messageId, "sent");
        }

        return {
          success: true,
          chatId,
          messageId,
          sentAt: new Date().toISOString(),
          result: sendResult
        };
      } catch (error) {
        logger.error({ error, chatId, messageId }, `Failed to send batch message ${i + 1}`);

        // Update status to failed if messageId is provided
        if (messageId) {
          try {
            await updateMessageStatus(messageId, "failed");
          } catch (statusError) {
            logger.error({ statusError, messageId }, `Failed to update message status to failed`);
          }
        }

        return {
          success: false,
          chatId,
          messageId,
          error: error.message,
          failedAt: new Date().toISOString()
        };
      }
    });

    results.push(result);

    // Add delay between messages (except for the last one)
    if (i < messages.length - 1 && delayBetween > 0) {
      await context.sleep(delayBetween);
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failedCount = results.length - successCount;

  logger.info(`Batch workflow completed. Success: ${successCount}, Failed: ${failedCount}, batchId: ${batchId}`);

  return {
    batchId,
    totalMessages: messages.length,
    successCount,
    failedCount,
    results,
    completedAt: new Date().toISOString()
  };
});

/**
 * Cleanup Workflow - Handles cleanup of old completed messages
 * Payload structure: { olderThanDays: number }
 */
export const cleanupWorkflow = serve(async (context) => {
  const { olderThanDays = 30 } = context.requestPayload;

  logger.info(`Starting cleanup workflow for messages older than ${olderThanDays} days`);

  const result = await context.run("cleanup-messages", async () => {
    try {
      const { Redis } = await import("@upstash/redis");
      const redis = new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });

      const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
      let cleanedCount = 0;

      // Get completed and failed messages older than cutoff
      const completedMessages = await redis.smembers('scheduled:status:sent');
      const failedMessages = await redis.smembers('scheduled:status:failed');
      const allMessages = [...completedMessages, ...failedMessages];

      for (const messageId of allMessages) {
        const messageData = await redis.hget(`scheduled:${messageId}`, 'updatedAt');
        if (messageData && parseInt(messageData) < cutoffTime) {
          // Delete the message
          await redis.del(`scheduled:${messageId}`);
          await redis.srem('scheduled:status:sent', messageId);
          await redis.srem('scheduled:status:failed', messageId);
          await redis.zrem('scheduled:by-time', messageId);
          cleanedCount++;
        }
      }

      logger.info(`Cleanup workflow completed. Cleaned ${cleanedCount} messages`);
      return { cleanedCount, cutoffTime: new Date(cutoffTime).toISOString() };
    } catch (error) {
      logger.error({ error }, `Cleanup workflow failed`);
      throw error;
    }
  });

  return {
    success: true,
    ...result,
    completedAt: new Date().toISOString()
  };
});