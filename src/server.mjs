import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import compress from "@fastify/compress";
import {
  API_KEY,
  HOST_PORT,
  ENABLE_LOGGER,
  RATE_LIMIT,
  RATE_LIMIT_EXPIRE,
} from "./config.mjs";
import { messageRoute } from "./routes/message.mjs";

const fastify = Fastify({ logger: ENABLE_LOGGER });

fastify.register(compress);

fastify.register(rateLimit, {
  max: RATE_LIMIT,
  timeWindow: RATE_LIMIT_EXPIRE * 1000, // convert detik ke milidetik
});

// PreHandler hook untuk verifikasi API key
fastify.addHook("preHandler", async (request, reply) => {
  const apiKey = request.headers["key"];
  if (!apiKey || apiKey !== API_KEY) {
    reply.status(401).send({
      status: "error",
      message: "API key tidak valid atau tidak disediakan.",
    });
    return;
  }
});

// Daftarkan route
fastify.register(messageRoute);

// Fungsi untuk menjalankan server
export function startServer() {
  fastify.listen({ port: HOST_PORT }, (err, address) => {
    if (err) {
      fastify.log.error(err);
      process.exit(1);
    }
    fastify.log.info(`Server berjalan di ${address}`);
  });
}
