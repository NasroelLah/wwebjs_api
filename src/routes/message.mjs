import { client } from "../whatsappClient.mjs";
import pkg from "whatsapp-web.js";
const { MessageMedia } = pkg;

export async function messageRoute(fastify, options) {
  fastify.post(
    "/message",
    {
      schema: {
        body: {
          type: "object",
          required: ["recipient_type", "to", "type"],
          properties: {
            recipient_type: { type: "string", enum: ["group", "individual"] },
            to: { type: "string" },
            type: { type: "string", enum: ["text", "image", "document"] },
            text: {
              type: "object",
              required: ["body"],
              properties: { body: { type: "string" } },
            },
            media: {
              type: "object",
              properties: {
                url: { type: "string" },
                base64: { type: "string" },
                mimeType: { type: "string" },
                filename: { type: "string" },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { recipient_type, to, type, text, media } = request.body;
      if (!recipient_type || !to) {
        reply.status(400).send({
          status: "error",
          message: "Missing required fields.",
        });
        return;
      }
      let chatId = recipient_type === "group" ? `${to}@g.us` : `${to}@c.us`;

      try {
        if (type === "text") {
          if (!text || !text.body) {
            reply.status(400).send({
              status: "error",
              message: "Text body is required for type 'text'.",
            });
            return;
          }
          await client.sendMessage(chatId, text.body);
        } else if (type === "image" || type === "document") {
          if (!media || (!media.url && !media.base64)) {
            reply.status(400).send({
              status: "error",
              message:
                "Media url or base64 is required for image/document messages.",
            });
            return;
          }
          let mediaContent;
          if (media.url) {
            mediaContent = await MessageMedia.fromUrl(media.url);
          } else {
            if (!media.mimeType) {
              reply.status(400).send({
                status: "error",
                message: "mimeType is required when sending media via base64.",
              });
              return;
            }
            mediaContent = new MessageMedia(
              media.mimeType,
              media.base64,
              media.filename || ""
            );
          }
          const optionsMedia =
            type === "document" ? { sendMediaAsDocument: true } : {};
          await client.sendMessage(chatId, mediaContent, optionsMedia);
        } else {
          reply.status(400).send({
            status: "error",
            message: "Unsupported message type.",
          });
          return;
        }
        reply.status(200).send({
          status: "success",
          message: `Message sent to ${recipient_type} ${to}`,
        });
      } catch (error) {
        fastify.log.error(error, "Failed to send message");
        reply.status(500).send({
          status: "error",
          message: `Failed to send message: ${error.message}`,
        });
      }
    }
  );
}
