import { workflowManager } from "./workflowHelper.mjs";

export async function addMessageToQueue(chatId, content, options, delay) {
  return workflowManager.scheduleMessage(chatId, content, options, delay);
}

export async function addBatchMessagesToQueue(messages, delayBetween = 1000) {
  return workflowManager.scheduleBatchMessages(messages, delayBetween);
}
