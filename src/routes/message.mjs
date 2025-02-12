import "dotenv/config";
import logger from "../logger.mjs";
import { validateApiKey } from "../middleware/auth.mjs";
import { buildMessageContent } from "../helpers/messageHelper.mjs";
import { scheduleDispatch } from "../helpers/scheduleHelper.mjs";
import { sendMessageWithRetry } from "../helpers/sendHelper.mjs";

export async function messageRoute(fastify, options) {
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
}
