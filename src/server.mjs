/* global process */
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import compress from "@fastify/compress";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import sanitizeInput from "./middleware/sanitize.mjs";
import {
  HOST_PORT,
  ENABLE_LOGGER,
  RATE_LIMIT,
  ALLOWED_ORIGIN_LIST,
  ALLOW_CLOUDFLARE_TUNNEL_ORIGINS,
  RATE_LIMIT_EXPIRE,
} from "./config.mjs";
import { messageRoute } from "./routes/message.mjs";
import { batchMessageRoute } from "./routes/batchMessage.mjs";
import { healthRoute } from "./routes/health.mjs";
import { rootRoute } from "./routes/root.mjs";
import { adminRoute } from "./routes/admin.mjs";
import queueManagementRoutes from "./routes/queue.mjs";

// Import workflow routes
import messageWorkflowRoute from "./routes/workflows/message.mjs";
import batchMessageWorkflowRoute from "./routes/workflows/batchMessage.mjs";
import cleanupWorkflowRoute from "./routes/workflows/cleanup.mjs";
import logger from "./logger.mjs";
import { errorHandler } from "./errors/ErrorHandler.mjs";
import { validateApiKey } from "./middleware/auth.mjs";

const fastify = Fastify({ 
  logger: ENABLE_LOGGER,
  bodyLimit: 10485760, // 10MB limit
  trustProxy: true // For rate limiting behind proxy
});

// Security headers
fastify.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'sha256-sA1ZbEzEoxoOXxNB0ZHbl/mrnC39IhyUWH1TAjVq+pw='"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
});

function isAllowedCorsOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGIN_LIST.includes('*')) return true;
  if (ALLOWED_ORIGIN_LIST.includes(origin)) return true;

  try {
    const { hostname } = new URL(origin);
    if (ALLOW_CLOUDFLARE_TUNNEL_ORIGINS && hostname.endsWith('.trycloudflare.com')) {
      return true;
    }
  } catch (error) {
    logger.warn({ origin, error: error.message }, 'Invalid CORS origin received');
    return false;
  }

  return false;
}

// CORS configuration
fastify.register(cors, {
  origin: (origin, callback) => {
    if (isAllowedCorsOrigin(origin)) {
      return callback(null, true);
    }

    logger.warn({ origin }, "Blocked CORS origin");
    return callback(null, false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
});

fastify.addHook("preValidation", sanitizeInput);
fastify.decorate("authenticate", async (request, reply) => validateApiKey(request, reply));

fastify.addHook("onRequest", (request, reply, done) => {
  request.startTime = Date.now();
  done();
});

fastify.addHook("onRequest", async (request) => {
  logger.info(`${request.method} ${request.url}`);
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

// Remove global auth hook - will be applied per route instead

fastify.register(rootRoute);
fastify.register(messageRoute);
fastify.register(batchMessageRoute);
fastify.register(healthRoute);
fastify.register(queueManagementRoutes);
fastify.register(adminRoute);

// Register workflow routes
fastify.register(async function (fastify) {
  fastify.register(messageWorkflowRoute, { prefix: '/api/workflows/message' });
  fastify.register(batchMessageWorkflowRoute, { prefix: '/api/workflows/batch-message' });
  fastify.register(cleanupWorkflowRoute, { prefix: '/api/workflows/cleanup' });
});

// Global error handler
fastify.setErrorHandler(async (error, request, reply) => {
  await errorHandler.handleError(error, reply);
});

export function startServer() {
  fastify.listen({ port: HOST_PORT, host: '0.0.0.0' }, (err, address) => {
    if (err) {
      logger.error(err);
      process.exit(1);
    }
    logger.info(`Server running at ${address}`);
  });
}

export async function closeServer() {
  await fastify.close();
}

export { fastify };

