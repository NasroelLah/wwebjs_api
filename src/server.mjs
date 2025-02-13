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
import logger from "./logger.mjs";
import { validateApiKey } from "./middleware/auth.mjs";
import { processScheduledMessages } from "./helpers/queueHelper.mjs";

const fastify = Fastify({ logger: ENABLE_LOGGER });

// Response formatter hook for standardized responses in English
fastify.addHook("onSend", async (request, reply, payload) => {
  let data;
  try {
    data = JSON.parse(payload);
  } catch (e) {
    data = payload;
  }
  const response = {
    status: data.status || "success",
    message: data.message || "",
  };
  return JSON.stringify(response);
});

fastify.register(compress);
fastify.register(rateLimit, {
  max: RATE_LIMIT,
  timeWindow: RATE_LIMIT_EXPIRE * 1000,
});

fastify.addHook("preHandler", async (request, reply) => {
  if (!validateApiKey(request, reply)) return;
});

fastify.register(messageRoute);

export function startServer() {
  fastify.listen({ port: HOST_PORT }, (err, address) => {
    if (err) {
      logger.error(err);
      process.exit(1);
    }
    logger.info(`Server running at ${address}`);
    processScheduledMessages();
  });
}
