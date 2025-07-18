import "dotenv/config";
import logger from "../logger.mjs";
import { validateApiKey } from "../middleware/auth.mjs";
import { buildMessageContent } from "../helpers/messageHelper.mjs";
import { scheduleDispatch } from "../helpers/scheduleHelper.mjs";
import { sendMessageWithRetry } from "../helpers/sendHelper.mjs";
import { isValidScheduleFormat } from "../helpers/validationHelper.mjs";
import {
  getDeviceStatus,
  connectDevice,
  removeDevice,
} from "../controllers/deviceController.mjs";
import { messageSchema, successResponseSchema, errorResponseSchema } from "../schemas/messageSchemas.mjs";
import { AppError, ErrorTypes, HttpStatusCodes } from "../errors/AppError.mjs";

export async function messageRoute(fastify) {
  // Apply auth to all routes in this plugin
  fastify.addHook("preHandler", async (request, reply) => {
    validateApiKey(request, reply);
  });

  fastify.post(
    "/message",
    {
      schema: {
        description: "Send a message to a specified recipient.",
        tags: ['Messages'],
        ...messageSchema,
        response: {
          200: successResponseSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          500: errorResponseSchema
        }
      },
      attachValidation: true
    },
    async (request, reply) => {
      // Handle validation errors
      if (request.validationError) {
        throw new AppError(
          ErrorTypes.VALIDATION_ERROR,
          HttpStatusCodes.BAD_REQUEST,
          `Validation failed: ${request.validationError.message}`,
          true
        );
      }

      const {
        recipient_type,
        to,
        type,
        text,
        media,
        location,
        schedule,
        caption,
      } = request.body;
      
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
        
        logger.info(`Preparing to send ${type} message to ${chatId}`);

        if (
          schedule &&
          scheduleDispatch(chatId, messageContent, sendOptions, schedule)
        ) {
          logger.info(`Message scheduled for ${schedule}`);
          return reply.code(200).send({
            status: "success",
            message: "Message scheduled successfully.",
          });
        }
        
        await sendMessageWithRetry(chatId, messageContent, sendOptions);
        logger.info(`Message sent to ${chatId}`);
        
        return reply.code(200).send({
          status: "success",
          message: "Message sent successfully.",
        });
      } catch (error) {
        logger.error(`Processing error: ${error.message}`);
        
        if (error instanceof AppError) {
          throw error; // Re-throw AppError to be handled by global handler
        }
        
        // Wrap unknown errors
        throw new AppError(
          ErrorTypes.WHATSAPP_ERROR,
          HttpStatusCodes.INTERNAL_SERVER_ERROR,
          "Failed to send message",
          true
        );
      }
    }
  );

  fastify.get("/device-status", getDeviceStatus);
  fastify.get("/device-connect", connectDevice);
  fastify.delete("/device-remove", removeDevice);
}
