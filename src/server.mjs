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
  RATE_LIMIT_EXPIRE,
} from "./config.mjs";
import { messageRoute } from "./routes/message.mjs";
import { batchMessageRoute } from "./routes/batchMessage.mjs";
import { healthRoute } from "./routes/health.mjs";
import { rootRoute } from "./routes/root.mjs";

// Import workflow routes
import messageWorkflowRoute from "./routes/workflows/message.mjs";
import batchMessageWorkflowRoute from "./routes/workflows/batchMessage.mjs";
import cleanupWorkflowRoute from "./routes/workflows/cleanup.mjs";
import logger from "./logger.mjs";
import { errorHandler } from "./errors/ErrorHandler.mjs";

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
      scriptSrc: ["'self'"],
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

// CORS configuration
fastify.register(cors, {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Add your allowed origins here
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'];
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    return callback(new Error("Not allowed by CORS"), false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
});

fastify.addHook("preValidation", sanitizeInput);

fastify.addHook("onRequest", async (request) => {
  logger.info(`${request.method} ${request.url}`);
});

fastify.addHook("onSend", async (request, _reply, payload) => {
  let data;
  try {
    data = JSON.parse(payload);
  } catch {
    // If payload is not JSON, return as is
    return payload;
  }
  
  // If response already has proper structure, don't wrap it
  if (data && (data.name || data.version || data.status || data.timestamp)) {
    return payload;
  }
  
  // Only wrap responses that need the standard API format
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

// Remove global auth hook - will be applied per route instead

fastify.register(rootRoute);
fastify.register(messageRoute);
fastify.register(batchMessageRoute);
fastify.register(healthRoute);

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

// Global uncaught exception handlers
process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled Promise Rejection');
  throw reason; // Let uncaughtException handle it
});

process.on('uncaughtException', async (error) => {
  logger.error({ error }, 'Uncaught Exception');
  await errorHandler.handleError(error);
  if (!errorHandler.isTrustedError(error)) {
    process.exit(1);
  }
});
