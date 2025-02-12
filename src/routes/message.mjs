import { client } from "../whatsappClient.mjs";

export async function messageRoute(fastify, options) {
  fastify.post(
    "/message",
    {
      schema: {
        body: {
          type: "object",
          required: ["recipient_type", "to", "type", "text"],
          properties: {
            recipient_type: { type: "string", enum: ["group", "individual"] },
            to: { type: "string" },
            type: { type: "string", const: "text" },
            text: {
              type: "object",
              required: ["body"],
              properties: { body: { type: "string" } },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { recipient_type, to, type, text } = request.body;
      if (!recipient_type || !to || !text || !text.body) {
        reply.status(400).send({
          status: "error",
          message: "Missing required fields.",
        });
        return;
      }
      if (type !== "text") {
        reply.status(400).send({
          status: "error",
          message: "Only text messages are supported.",
        });
        return;
      }
      let chatId = recipient_type === "group" ? `${to}@g.us` : `${to}@c.us`;
      try {
        await client.sendMessage(chatId, text.body);
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
