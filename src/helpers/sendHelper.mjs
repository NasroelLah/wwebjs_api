import { client, isClientReady } from "../whatsappClient.mjs";
import logger from "../logger.mjs";
import { AppError, ErrorTypes, HttpStatusCodes } from "../errors/AppError.mjs";
import wwebjs from "whatsapp-web.js";
import { isLidResolutionError } from "./lidPatch.mjs";

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
    !(content instanceof MessageMedia) &&
    typeof content === "object" &&
    content.mimetype &&
    content.data
  ) {
    content = new MessageMedia(
      content.mimetype,
      content.data,
      content.filename || "",
      content.filesize
    );
  }

  const maxRetries = 3;
  const baseDelay = 1000; // 1 second
  let attempt = 0;
  
  while (attempt < maxRetries) {
    try {
      logger.debug({ attempt: attempt + 1, chatId }, "Attempting to send message");
      
      // Add timeout to prevent hanging
      let timer;
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new AppError(
          ErrorTypes.NETWORK_ERROR,
          HttpStatusCodes.REQUEST_TIMEOUT,
          "Message send timed out; delivery status is unknown. Check the chat before retrying.",
          true
        )), 30000);
      });

      const sendPromise = Promise.resolve().then(() => client.sendMessage(chatId, content, options));
      const result = await Promise.race([sendPromise, timeoutPromise]).finally(() =>
        clearTimeout(timer)
      );
      if (!result) {
        throw new AppError(
          ErrorTypes.NETWORK_ERROR,
          HttpStatusCodes.REQUEST_TIMEOUT,
          "WhatsApp did not return a sent message; delivery status is unknown.",
          true
        );
      }
      
      logger.info({ chatId }, "Message sent successfully");
      return result;
    } catch (error) {
      if (error instanceof AppError && error.statusCode === HttpStatusCodes.REQUEST_TIMEOUT) throw error;
      const message = String(error?.message ?? error ?? "");
      if (error?.statusCode === HttpStatusCodes.REQUEST_TIMEOUT ||
          error?.code === "ETIMEDOUT" || /timed?\s*out|timeout/i.test(message)) {
        throw new AppError(
          ErrorTypes.NETWORK_ERROR,
          HttpStatusCodes.REQUEST_TIMEOUT,
          "Message send timed out; delivery status is unknown. Check the chat before retrying.",
          true
        );
      }
      // LID failures are not safely resolved by repeating the send.
      if (isLidResolutionError(error)) {
        logger.error(
          { chatId, error: message },
          "LID resolution failed for recipient; not retrying"
        );
        throw new AppError(
          ErrorTypes.VALIDATION_ERROR,
          HttpStatusCodes.BAD_REQUEST,
          "WhatsApp could not resolve this recipient's LID. Verify the recipient in WhatsApp Web and check library compatibility before retrying.",
          true
        );
      }

      attempt++;
      const isLastAttempt = attempt >= maxRetries;
      
      if (isLastAttempt) {
        // Classify the error type
        let errorType = ErrorTypes.WHATSAPP_ERROR;
        let statusCode = HttpStatusCodes.INTERNAL_SERVER_ERROR;
        let userMessage = "Failed to send message after multiple attempts";
        
        if (message.includes("serialize")) {
          errorType = ErrorTypes.WHATSAPP_ERROR;
          statusCode = HttpStatusCodes.SERVICE_UNAVAILABLE;
          userMessage = "WhatsApp service temporarily unavailable. Please try again later.";
        } else if (message.includes("not found") || message.includes("invalid")) {
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
