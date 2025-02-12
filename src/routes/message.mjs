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
              properties: {
                body: { type: "string" },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { recipient_type, to, type, text } = request.body;

      // Validasi input
      if (!recipient_type || !to || !text || !text.body) {
        reply.status(400).send({
          status: "error",
          message:
            "recipient_type, nomor/ID tujuan, dan isi pesan harus disediakan.",
        });
        return;
      }

      // Hanya mendukung pesan teks
      if (type !== "text") {
        reply.status(400).send({
          status: "error",
          message: "Saat ini hanya pesan teks yang didukung.",
        });
        return;
      }

      // Menentukan format chatId berdasarkan tipe penerima
      let chatId;
      if (recipient_type === "group") {
        chatId = `${to}@g.us`;
      } else if (recipient_type === "individual") {
        chatId = `${to}@c.us`;
      } else {
        reply.status(400).send({
          status: "error",
          message: 'recipient_type harus "individual" atau "group".',
        });
        return;
      }

      try {
        await client.sendMessage(chatId, text.body);
        reply.status(200).send({
          status: "success",
          message: `Pesan berhasil dikirim ke ${recipient_type} ${to}`,
        });
      } catch (error) {
        fastify.log.error(error, "Gagal mengirim pesan");
        reply.status(500).send({
          status: "error",
          message: `Gagal mengirim pesan: ${error.message}`,
        });
      }
    }
  );
}
