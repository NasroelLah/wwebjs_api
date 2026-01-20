import { client, isClientReady } from "../whatsappClient.mjs";
import logger from "../logger.mjs";
import { AppError, ErrorTypes, HttpStatusCodes } from "../errors/AppError.mjs";
import wwebjs from "whatsapp-web.js";

const { MessageMedia } = wwebjs;

// Enhanced retry logic with exponential backoff
export async function sendMessageWithRetry(chatId, content, options = {}) {
  // Check if client is ready
  if (!isClientReady()) {
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.SERVICE_UNAVAILABLE,
      "WhatsApp client is not ready. Please ensure the QR code is scanned and client is connected.",
      true
    );
  }

  // Convert MessageMedia if needed
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
  const baseDelay = 1000; // 1 second
  let attempt = 0;
  
  while (attempt < maxRetries) {
    try {
      logger.debug({ attempt: attempt + 1, chatId }, "Attempting to send message");
      
      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Message send timeout")), 30000)
      );
      
      const sendPromise = client.sendMessage(chatId, content, options);
      const result = await Promise.race([sendPromise, timeoutPromise]);
      
      logger.info({ chatId }, "Message sent successfully");
      return result;
    } catch (error) {
      attempt++;
      const isLastAttempt = attempt >= maxRetries;
      
      logger.warn({ 
        attempt, 
        maxRetries, 
        chatId, 
        error: error.message,
        isLastAttempt 
      }, `Send attempt failed`);
      
      if (isLastAttempt) {
        // Classify the error type
        let errorType = ErrorTypes.WHATSAPP_ERROR;
        let statusCode = HttpStatusCodes.INTERNAL_SERVER_ERROR;
        let userMessage = "Failed to send message after multiple attempts";
        
        if (error.message.includes("serialize")) {
          errorType = ErrorTypes.WHATSAPP_ERROR;
          statusCode = HttpStatusCodes.SERVICE_UNAVAILABLE;
          userMessage = "WhatsApp service temporarily unavailable. Please try again later.";
        } else if (error.message.includes("timeout")) {
          errorType = ErrorTypes.NETWORK_ERROR;
          statusCode = HttpStatusCodes.REQUEST_TIMEOUT;
          userMessage = "Message send timeout. Please check your connection and try again.";
        } else if (error.message.includes("not found") || error.message.includes("invalid")) {
          errorType = ErrorTypes.VALIDATION_ERROR;
          statusCode = HttpStatusCodes.BAD_REQUEST;
          userMessage = "Invalid phone number or chat ID.";
        }
        
        throw new AppError(
          errorType,
          statusCode,
          userMessage,
          true
        );
      }
      
      // Exponential backoff: wait longer between retries
      const delay = baseDelay * Math.pow(2, attempt - 1);
      logger.debug({ delay }, `Waiting before retry`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
