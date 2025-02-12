import { client } from "../whatsappClient.mjs";
import logger from "../logger.mjs";

export async function sendMessageWithRetry(chatId, content, options = {}) {
  const maxRetries = 3;
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await client.sendMessage(chatId, content, options);
    } catch (error) {
      attempt++;
      logger.error(`Attempt ${attempt} failed: ${error.message}`);
      if (attempt >= maxRetries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
