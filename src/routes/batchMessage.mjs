import "dotenv/config";
import logger from "../logger.mjs";
import { validateApiKey } from "../middleware/auth.mjs";
import { buildMessageContent } from "../helpers/messageHelper.mjs";
import { scheduleDispatch } from "../helpers/scheduleHelper.mjs";
import { sendMessageWithRetry } from "../helpers/sendHelper.mjs";
import { isValidScheduleFormat } from "../helpers/validationHelper.mjs";

export async function batchMessageRoute(fastify) {
  fastify.addHook("preHandler", async (request, reply) => {
    if (!validateApiKey(request, reply)) return;
  });

  fastify.post("/messages/batch", async (request, reply) => {
    const { messages } = request.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return reply.code(400).send({
        status: "error",
        message: "No messages supplied.",
      });
    }

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

        if (
          schedule &&
          scheduleDispatch(chatId, messageContent, sendOptions, schedule)
        ) {
          logger.info(`Message scheduled for ${chatId} at ${schedule}`);
          results.push({
            chatId,
            status: "success",
            message: "Message scheduled successfully.",
          });
          continue;
        }
        await sendMessageWithRetry(chatId, messageContent, sendOptions);
        logger.info(`Message sent to ${chatId}`);
        results.push({
          chatId,
          status: "success",
          message: "Message sent successfully.",
        });
      } catch (error) {
        logger.error(`Error sending message to ${chatId}: ${error.message}`);
        results.push({
          chatId,
          status: "error",
          message: error.message,
        });
      }
    }
    return reply.code(200).send({
      status: "success",
      message: "Batch process completed.",
      data: results,
    });
  });
}
