import "dotenv/config";
import logger from "../logger.mjs";
import { validateApiKey } from "../middleware/auth.mjs";
import { buildMessageContent } from "../helpers/messageHelper.mjs";
import { scheduleDispatch } from "../helpers/scheduleHelper.mjs";
import { sendMessageWithRetry } from "../helpers/sendHelper.mjs";
import { isValidScheduleFormat } from "../helpers/validationHelper.mjs";
import { client } from "../whatsappClient.mjs";

export async function messageRoute(fastify) {
  fastify.addHook("preHandler", async (request, reply) => {
    if (!validateApiKey(request, reply)) return;
  });

  fastify.post(
    "/message",
    {
      schema: {
        description: "Send a message to a specified recipient.",
      },
    },
    async (request, reply) => {
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
          return reply.code(400).send({
            status: "error",
            message: "Invalid schedule format.",
          });
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
        return reply.code(500).send({
          status: "error",
          message: "Failed to send message.",
        });
      }
    }
  );

  fastify.get(
    "/device-status",
    {
      schema: {
        description: "Get connected device information.",
      },
    },
    async (request, reply) => {
      try {
        const info = await client.info;
        return reply.code(200).send({
          status: "success",
          message: "Device information retrieved successfully.",
          data: info,
        });
      } catch (error) {
        logger.error(`Error retrieving device information: ${error.message}`);
        return reply.code(500).send({
          status: "error",
          message: "Failed to retrieve device information.",
        });
      }
    }
  );

  fastify.get(
    "/device-connect",
    {
      schema: {
        description: "Get QR code for connecting device.",
      },
    },
    async (request, reply) => {
      try {
        if (client.info && client.info.wid) {
          return reply.code(200).send({
            status: "success",
            message: "Device already connected.",
          });
        }

        let qrCode;
        client.on("qr", (qr) => {
          qrCode = qr;
        });
        client.initialize();
        return reply.code(200).send({
          status: "success",
          message: "QR code generated successfully.",
          data: qrCode,
        });
      } catch (error) {
        logger.error(`Error generating QR code: ${error.message}`);
        return reply.code(500).send({
          status: "error",
          message: "Failed to generate QR code.",
        });
      }
    }
  );
}
