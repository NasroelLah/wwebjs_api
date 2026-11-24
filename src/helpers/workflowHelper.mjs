import { randomUUID } from "node:crypto";
import { Client } from "@upstash/workflow";
import { workflowConfig } from "../config.mjs";
import { saveScheduledMessage, markEnqueueUnknown } from "./redisHelper.mjs";
import { AppError, ErrorTypes, HttpStatusCodes } from "../errors/AppError.mjs";

function getClient() {
  if (!workflowConfig.qstashToken || !workflowConfig.qstashCurrentSigningKey || !workflowConfig.qstashNextSigningKey) {
    throw new AppError(ErrorTypes.CONFIGURATION_ERROR, HttpStatusCodes.SERVICE_UNAVAILABLE, "Upstash Workflow token and both signing keys are required", true);
  }
  return new Client({ token: workflowConfig.qstashToken, baseUrl: workflowConfig.qstashUrl });
}

async function trigger(path, body, delay = 0) {
  const client = getClient();
  const url = new URL(path, workflowConfig.baseUrl).toString();
  return client.trigger({ url, body, retries: 3, ...(delay > 0 && { delay: `${Math.ceil(delay / 1000)}s` }) });
}

class WorkflowManager {
  async scheduleMessage(chatId, content, options, delay = 0) {
    getClient();
    const messageId = await saveScheduledMessage(chatId, content, options, delay);
    try {
      await trigger("/api/workflows/message", { messageId }, delay);
      return messageId;
    } catch (error) {
      await markEnqueueUnknown(messageId);
      throw error;
    }
  }

  async scheduleBatchMessages(messages, delayBetween = 1000) {
    getClient();
    const batchId = `batch-${randomUUID()}`;
    const messageIds = [];
    try {
      for (const [index, message] of messages.entries()) {
        messageIds.push(await saveScheduledMessage(message.chatId, message.content, message.options, index * delayBetween));
      }
      const { workflowRunId } = await trigger("/api/workflows/batch-message", { messageIds, batchId, delayBetween });
      return { batchId, messageIds, workflowRunId, messageCount: messageIds.length };
    } catch (error) {
      await Promise.allSettled(messageIds.map((id) => markEnqueueUnknown(id)));
      throw error;
    }
  }

  async cancelWorkflow(workflowRunId) {
    return getClient().cancel(workflowRunId);
  }

  async getWorkflowStatus(workflowRunId) {
    return getClient().logs({ workflowRunId });
  }

  async scheduleCleanup(olderThanDays = 30) {
    const { workflowRunId } = await trigger("/api/workflows/cleanup", { olderThanDays });
    return workflowRunId;
  }
}

export const workflowManager = new WorkflowManager();
