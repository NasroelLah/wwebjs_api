import "dotenv/config";
import logger from "../logger.mjs";
import { validateApiKey } from "../middleware/auth.mjs";
import { buildMessageContent } from "../helpers/messageHelper.mjs";
import { scheduleDispatch } from "../helpers/scheduleHelper.mjs";
import { addBatchMessagesToQueue } from "../helpers/queueHelper.mjs";
import { isValidScheduleFormat } from "../helpers/validationHelper.mjs";
import { batchMessageSchema, acceptedBatchResponseSchema, errorResponseSchema } from "../schemas/messageSchemas.mjs";
import { AppError, ErrorTypes, HttpStatusCodes } from "../errors/AppError.mjs";

export async function batchMessageRoute(fastify) {
  // Rate limiting for batch operations
  await fastify.register(import('@fastify/rate-limit'), {
    max: 5, // 5 requests per minute for batch operations
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      status: "error",
      error: {
        type: "RATE_LIMIT_ERROR",
        message: "Too many batch requests. Please wait before sending another batch.",
        details: "Rate limit: 5 requests per minute"
      }
    })
  });

  // Apply auth to all routes in this plugin
  fastify.addHook("preHandler", async (request, reply) => {
    validateApiKey(request, reply);
  });

  fastify.post("/messages/batch", {
    schema: {
      description: "Send multiple messages in batch",
      tags: ['Messages'],
      ...batchMessageSchema,
      response: {
        202: acceptedBatchResponseSchema,
        400: errorResponseSchema,
        401: errorResponseSchema,
        500: errorResponseSchema
      }
    },
    attachValidation: true
  }, async (request, reply) => {
    const startTime = Date.now();
    
    // Handle validation errors
    if (request.validationError) {
      throw new AppError(
        ErrorTypes.VALIDATION_ERROR,
        HttpStatusCodes.BAD_REQUEST,
        `Validation failed: ${request.validationError.message}`,
        true
      );
    }

    const { messages } = request.body;
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      throw new AppError(
        ErrorTypes.VALIDATION_ERROR,
        HttpStatusCodes.BAD_REQUEST,
        "No messages supplied",
        true
      );
    }

    // Validate batch size consistently with schema
    if (messages.length > 50) {
      throw new AppError(
        ErrorTypes.VALIDATION_ERROR,
        HttpStatusCodes.BAD_REQUEST,
        "Batch size cannot exceed 50 messages",
        true
      );
    }

    // Validate message recipients are unique
    const recipients = messages.map(msg => msg.to);
    const uniqueRecipients = new Set(recipients);
    if (uniqueRecipients.size !== recipients.length) {
      throw new AppError(
        ErrorTypes.VALIDATION_ERROR,
        HttpStatusCodes.BAD_REQUEST,
        "Duplicate recipients found in batch. Each recipient can only receive one message per batch.",
        true
      );
    }

    logger.info({
      messageCount: messages.length,
      recipients: recipients.length
    }, "Batch message request received");

    const queuedMessages = [];
    const results = [];
    for (const msg of messages) {
      const {
        recipient_type,
        to,
        type,
        text,
        media,
        location,
        schedule,
        caption,
      } = msg;
      const chatId = recipient_type === "group" ? `${to}@g.us` : `${to}@c.us`;
      try {
        if (schedule && !isValidScheduleFormat(schedule)) {
          logger.warn(`Invalid schedule format for message to ${chatId}`);
          results.push({
            chatId,
            status: "error",
            message: "Invalid schedule format.",
          });
          continue;
        }
        const { messageContent, sendOptions } = await buildMessageContent({
          type,
          text,
          media,
          location,
          caption,
        });
        logger.info(`Preparing to send ${type} message to ${chatId}`);

        if (schedule) {
          const scheduledMessageId = await scheduleDispatch(chatId, messageContent, sendOptions, schedule);
          if (scheduledMessageId) {
            logger.info(`Message scheduled for ${chatId} at ${schedule}`);
            results.push({
              chatId,
              status: "success",
              message: "Message scheduled successfully.",
              messageId: scheduledMessageId
            });
            continue;
          }
        }
        queuedMessages.push({ chatId, content: messageContent, options: sendOptions });
        results.push({
          chatId,
          status: "queued",
          message: "Message queued for batch workflow.",
        });
      } catch (error) {
        logger.error({
          chatId,
          error: error.message,
          stack: error.stack
        }, `Error sending message to ${chatId}`);
        
        results.push({
          chatId,
          status: "error",
          message: error.message,
          errorType: error instanceof AppError ? error.type : 'UNKNOWN_ERROR'
        });
      }
    }

    const duration = Date.now() - startTime;
    const queuedCount = results.filter(r => r.status === 'queued').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    logger.info({
      messageCount: messages.length,
      queuedCount,
      errorCount,
      duration
    }, "Batch message processing completed");

    if (queuedMessages.length === 0) {
      return reply.code(200).send({
        status: "success",
        message: "Batch process completed",
        data: results,
        meta: {
          totalMessages: messages.length,
          queuedMessages: 0,
          processingTime: `${duration}ms`
        }
      });
    }

    const batchQueueResult = await addBatchMessagesToQueue(queuedMessages);

    logger.info({
      batchId: batchQueueResult.batchId,
      queuedMessages: queuedMessages.length,
      duration
    }, "Batch message workflow queued");

    return reply.code(202).send({
      status: "success",
      message: "Batch accepted for asynchronous processing",
      data: batchQueueResult
    });
  });
}
