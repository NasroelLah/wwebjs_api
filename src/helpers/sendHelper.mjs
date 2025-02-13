import { client } from "../whatsappClient.mjs";
import logger from "../logger.mjs";
import pkg from "whatsapp-web.js";
const { MessageMedia } = pkg;

export async function sendMessageWithRetry(chatId, content, options = {}) {
  // Reinitialize MessageMedia if content is a plain object (lost prototype during serialization)
  if (
    content &&
    typeof content === "object" &&
    content.mimetype &&
    content.data
  ) {
    content = new MessageMedia(
      content.mimetype,
      content.data,
      content.filename || ""
    );
  }

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
