/**
 * @fileoverview Message Routes - API endpoints for sending messages
 * @module routes/message
 */

import logger from "../logger.mjs";
import { validateApiKey } from "../middleware/auth.mjs";
import { buildMessageContent } from "../helpers/messageHelper.mjs";
import { scheduleDispatch } from "../helpers/scheduleHelper.mjs";
import { sendMessageWithRetry } from "../helpers/sendHelper.mjs";
import { isValidScheduleFormat } from "../helpers/validationHelper.mjs";
import { messageSchema, successResponseSchema, errorResponseSchema } from "../schemas/messageSchemas.mjs";
import { AppError, ErrorTypes, HttpStatusCodes } from "../errors/AppError.mjs";

/**
 * Message route plugin
 * @param {import('fastify').FastifyInstance} fastify - Fastify instance
 */
export async function messageRoute(fastify) {
  fastify.addHook("preHandler", async (request, reply) => {
    validateApiKey(request, reply);
  });

  fastify.post("/message", {
    schema: {
      description: "Send a message to a specified recipient",
      tags: ["Messages"],
      ...messageSchema,
      response: {
        200: successResponseSchema,
        400: errorResponseSchema,
        401: errorResponseSchema,
        500: errorResponseSchema,
      },
    },
    attachValidation: true,
  }, async (request, reply) => {
    if (request.validationError) {
      throw new AppError(
        ErrorTypes.VALIDATION_ERROR,
        HttpStatusCodes.BAD_REQUEST,
        `Validation failed: ${request.validationError.message}`,
        true
      );
    }

    const { recipient_type, to, type, text, media, location, schedule, caption } = request.body;
    const chatId = recipient_type === "group" ? `${to}@g.us` : `${to}@c.us`;

    try {
      if (schedule && !isValidScheduleFormat(schedule)) {
        throw new AppError(
          ErrorTypes.VALIDATION_ERROR,
          HttpStatusCodes.BAD_REQUEST,
          "Invalid schedule format. Expected: YYYY-MM-DD HH:MM:SS",
          true
        );
      }

      const { messageContent, sendOptions } = await buildMessageContent({
        type,
        text,
        media,
        location,
        caption,
      });

      logger.debug({ type, chatId }, "Preparing message");

      if (schedule && scheduleDispatch(chatId, messageContent, sendOptions, schedule)) {
        logger.info({ chatId, schedule }, "Message scheduled");
        return reply.send({
          status: "success",
          message: "Message scheduled successfully",
        });
      }

      await sendMessageWithRetry(chatId, messageContent, sendOptions);
      logger.info({ chatId }, "Message sent");

      return reply.send({
        status: "success",
        message: "Message sent successfully",
      });
    } catch (error) {
      if (error instanceof AppError) throw error;

      logger.error({ error: error.message, chatId }, "Failed to send message");
      throw new AppError(
        ErrorTypes.WHATSAPP_ERROR,
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        "Failed to send message",
        true
      );
    }
  });
}
