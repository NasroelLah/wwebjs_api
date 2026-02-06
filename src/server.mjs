import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import rateLimit from "@fastify/rate-limit";
import compress from "@fastify/compress";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import sanitizeInput from "./middleware/sanitize.mjs";
import {
  HOST_PORT,
  ENABLE_LOGGER,
  RATE_LIMIT,
  RATE_LIMIT_EXPIRE,
  appConfig,
} from "./config.mjs";
import { messageRoute } from "./routes/message.mjs";
import { batchMessageRoute } from "./routes/batchMessage.mjs";
import { healthRoute } from "./routes/health.mjs";
import { rootRoute } from "./routes/root.mjs";
import { contactRoute } from "./routes/contact.mjs";
import { chatRoute } from "./routes/chat.mjs";
import { groupRoute } from "./routes/group.mjs";
import { messageActionsRoute } from "./routes/messageActions.mjs";
import { autoResponseRoute } from "./routes/autoResponse.mjs";
import { deviceRoute } from "./routes/device.mjs";
import logger from "./logger.mjs";
import bree from "./jobs/breeTasks.mjs";
import { errorHandler } from "./errors/ErrorHandler.mjs";

// Get package version
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));

const fastify = Fastify({
  logger: ENABLE_LOGGER,
  bodyLimit: 10485760, // 10MB limit
  trustProxy: true,
  disableRequestLogging: true, // We handle logging manually
});

// Swagger documentation
await fastify.register(swagger, {
  openapi: {
    info: {
      title: "WhatsApp Web API",
      description: "REST API for WhatsApp Web integration using whatsapp-web.js",
      version: pkg.version,
    },
    servers: [
      { url: `http://localhost:${HOST_PORT}`, description: "Local server" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "API Key",
        },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: "Info", description: "API information" },
      { name: "Health", description: "Health check endpoints" },
      { name: "Device", description: "Device connection management" },
      { name: "Messages", description: "Send and manage messages" },
      { name: "Contacts", description: "Contact management" },
      { name: "Chats", description: "Chat management" },
      { name: "Groups", description: "Group management" },
      { name: "Auto-Response", description: "LLM auto-response configuration" },
    ],
  },
});

await fastify.register(swaggerUi, {
  routePrefix: "/docs",
  uiConfig: {
    docExpansion: "list",
    deepLinking: true,
  },
});

// Static files (Device Manager UI)
await fastify.register(fastifyStatic, {
  root: join(__dirname, "..", "public"),
  prefix: "/",
  decorateReply: false,
});

// Security headers
await fastify.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://cdn.tailwindcss.com"],
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
    preload: true,
  },
});

// CORS configuration
await fastify.register(cors, {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || ["http://localhost:3000"];
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("Not allowed by CORS"), false);
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});

// Compression
await fastify.register(compress, {
  encodings: ["gzip", "deflate"],
  threshold: 1024, // Only compress responses > 1KB
});

// Rate limiting
await fastify.register(rateLimit, {
  max: RATE_LIMIT,
  timeWindow: RATE_LIMIT_EXPIRE * 1000,
  cache: 10000, // Cache up to 10000 entries
});

// Request sanitization
fastify.addHook("preValidation", sanitizeInput);

// Request timing
fastify.addHook("onRequest", (request, _reply, done) => {
  request.startTime = Date.now();
  done();
});

// Response logging (only in development)
if (appConfig.isDevelopment) {
  fastify.addHook("onResponse", async (request, reply) => {
    const responseTime = Date.now() - request.startTime;
    logger.info(
      `${request.method} ${request.url} ${reply.statusCode} ${responseTime}ms`
    );
  });
}

// Response wrapper
fastify.addHook("onSend", async (_request, _reply, payload) => {
  let data;
  try {
    data = JSON.parse(payload);
  } catch {
    return payload;
  }

  if (data && (data.name || data.version || data.status || data.timestamp || data.openapi)) {
    return payload;
  }

  const response = {
    status: data.status || "success",
    message: data.message || "",
    ...(data.data && { data: data.data }),
  };
  return JSON.stringify(response);
});

// Register routes
fastify.register(rootRoute);
fastify.register(healthRoute);
fastify.register(deviceRoute);
fastify.register(messageRoute);
fastify.register(batchMessageRoute);
fastify.register(contactRoute);
fastify.register(chatRoute);
fastify.register(groupRoute);
fastify.register(messageActionsRoute);
fastify.register(autoResponseRoute);

// Global error handler
fastify.setErrorHandler(async (error, _request, reply) => {
  await errorHandler.handleError(error, reply);
});

/**
 * Start the server
 */
export function startServer() {
  fastify.listen({ port: HOST_PORT, host: "0.0.0.0" }, (err, address) => {
    if (err) {
      logger.error(err);
      process.exit(1);
    }
    logger.info(`Server running at ${address}`);
    logger.info(`API Documentation: ${address}/docs`);
    bree.start();
  });
}

// Graceful shutdown
process.on("unhandledRejection", (reason, promise) => {
  logger.error({ reason, promise }, "Unhandled Promise Rejection");
  throw reason;
});

process.on("uncaughtException", async (error) => {
  logger.error({ error }, "Uncaught Exception");
  await errorHandler.handleError(error);
  if (!errorHandler.isTrustedError(error)) {
    process.exit(1);
  }
});


