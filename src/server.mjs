/* global process */
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import compress from "@fastify/compress";
import helmet from "@fastify/helmet";
import sanitizeInput from "./middleware/sanitize.mjs";
import {
  HOST_PORT,
  ENABLE_LOGGER,
  RATE_LIMIT,
  RATE_LIMIT_EXPIRE,
} from "./config.mjs";
import { messageRoute } from "./routes/message.mjs";
import { batchMessageRoute } from "./routes/batchMessage.mjs";
import logger from "./logger.mjs";
import { validateApiKey } from "./middleware/auth.mjs";
import bree from "./jobs/breeTasks.mjs";

const fastify = Fastify({ logger: ENABLE_LOGGER });

fastify.register(helmet);

fastify.addHook("preValidation", sanitizeInput);

fastify.addHook("onRequest", async (request) => {
  logger.info(`${request.method} ${request.url}`);
});

fastify.addHook("onSend", async (request, _reply, payload) => {
  let data;
  try {
    data = JSON.parse(payload);
  } catch {
    data = payload;
  }
  const response = {
    status: data.status || "success",
    message: data.message || "",
    ...(data.data && { data: data.data }),
  };
  return JSON.stringify(response);
});

fastify.addHook("onRequest", (request, reply, done) => {
  request.startTime = Date.now();
  done();
});

fastify.addHook("onResponse", async (request, reply) => {
  const responseTime = Date.now() - request.startTime;
  logger.info(
    `${request.method} ${request.url} completed in ${responseTime}ms with status ${reply.statusCode}`
  );
});

fastify.register(compress);
fastify.register(rateLimit, {
  max: RATE_LIMIT,
  timeWindow: RATE_LIMIT_EXPIRE * 1000,
});

fastify.addHook("preHandler", async (request) => {
  if (!validateApiKey(request)) return;
});

fastify.register(messageRoute);
fastify.register(batchMessageRoute);

export function startServer() {
  fastify.listen({ port: HOST_PORT }, (err, address) => {
    if (err) {
      logger.error(err);
      process.exit(1);
    }
    logger.info(`Server running at ${address}`);
    bree.start();
  });
}
