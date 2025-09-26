import { Client } from "@upstash/workflow";
import logger from "../logger.mjs";
import { saveScheduledMessage } from "../helpers/redisHelper.mjs";
import { workflowConfig } from "../config.mjs";

class WorkflowManager {
  constructor() {
    this.client = null;
  }

  getClient() {
    if (!this.client) {
      this.client = new Client({
        token: workflowConfig.qstashToken,
        baseUrl: workflowConfig.qstashUrl,
      });
    }
    return this.client;
  }

  /**
   * Schedule a single message using Upstash Workflow
   * @param {string} chatId - Target chat ID
   * @param {Object} content - Message content
   * @param {Object} options - Message options
   * @param {number} delay - Delay in milliseconds
   * @returns {string} - Message ID
   */
  async scheduleMessage(chatId, content, options, delay = 0) {
    try {
      // Save message to Redis first
      const messageId = await saveScheduledMessage(chatId, content, options, delay);

      const payload = {
        chatId,
        content,
        options,
        messageId,
        delay
      };

      // Start the workflow
      const client = this.getClient();
      const workflowUrl = `${workflowConfig.baseUrl}/api/workflows/message`;

      const workflowRun = await client.start({
        url: workflowUrl,
        body: payload
      });

      logger.info(`Message workflow scheduled successfully. MessageId: ${messageId}, WorkflowRunId: ${workflowRun.workflowRunId}`);

      return messageId;
    } catch (error) {
      logger.error({ error, chatId }, 'Failed to schedule message workflow');
      throw error;
    }
  }

  /**
   * Schedule multiple messages as a batch
   * @param {Array} messages - Array of message objects
   * @param {number} delayBetween - Delay between messages in milliseconds
   * @returns {Object} - Batch result with message IDs
   */
  async scheduleBatchMessages(messages, delayBetween = 1000) {
    try {
      const batchId = `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const messagesWithIds = [];

      // Save each message to Redis and collect IDs
      for (const message of messages) {
        const { chatId, content, options } = message;
        const messageId = await saveScheduledMessage(chatId, content, options, 0); // No individual delay for batch
        messagesWithIds.push({
          ...message,
          messageId
        });
      }

      const payload = {
        messages: messagesWithIds,
        batchId,
        delayBetween
      };

      // Start the batch workflow
      const client = this.getClient();
      const workflowUrl = `${workflowConfig.baseUrl}/api/workflows/batch-message`;

      const workflowRun = await client.start({
        url: workflowUrl,
        body: payload
      });

      logger.info(`Batch message workflow scheduled successfully. BatchId: ${batchId}, WorkflowRunId: ${workflowRun.workflowRunId}, Messages: ${messages.length}`);

      return {
        batchId,
        messageIds: messagesWithIds.map(m => m.messageId),
        workflowRunId: workflowRun.workflowRunId,
        messageCount: messages.length
      };
    } catch (error) {
      logger.error({ error, messageCount: messages.length }, 'Failed to schedule batch message workflow');
      throw error;
    }
  }

  /**
   * Cancel a workflow by run ID
   * @param {string} workflowRunId - Workflow run ID
   */
  async cancelWorkflow(workflowRunId) {
    try {
      const client = this.getClient();
      await client.cancel({ workflowRunId });
      logger.info(`Workflow cancelled successfully: ${workflowRunId}`);
    } catch (error) {
      logger.error({ error, workflowRunId }, 'Failed to cancel workflow');
      throw error;
    }
  }

  /**
   * Get workflow status
   * @param {string} workflowRunId - Workflow run ID
   */
  async getWorkflowStatus(workflowRunId) {
    try {
      const client = this.getClient();
      // Note: This might need adjustment based on actual Upstash Workflow API
      const status = await client.get({ workflowRunId });
      return status;
    } catch (error) {
      logger.error({ error, workflowRunId }, 'Failed to get workflow status');
      throw error;
    }
  }

  /**
   * Schedule cleanup workflow
   * @param {number} olderThanDays - Clean messages older than this many days
   */
  async scheduleCleanup(olderThanDays = 30) {
    try {
      const payload = { olderThanDays };

      const client = this.getClient();
      const workflowUrl = `${workflowConfig.baseUrl}/api/workflows/cleanup`;

      const workflowRun = await client.start({
        url: workflowUrl,
        body: payload
      });

      logger.info(`Cleanup workflow scheduled successfully. WorkflowRunId: ${workflowRun.workflowRunId}, olderThanDays: ${olderThanDays}`);

      return workflowRun.workflowRunId;
    } catch (error) {
      logger.error({ error, olderThanDays }, 'Failed to schedule cleanup workflow');
      throw error;
    }
  }
}

// Singleton instance
const workflowManager = new WorkflowManager();

/**
 * Legacy compatibility function - maps to new workflow system
 * @param {string} chatId
 * @param {Object} content
 * @param {Object} options
 * @param {number} delay
 */
export async function addMessageToQueue(chatId, content, options, delay) {
  return await workflowManager.scheduleMessage(chatId, content, options, delay);
}

export { workflowManager };