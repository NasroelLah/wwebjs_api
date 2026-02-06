/**
 * @fileoverview Root Routes - API information endpoints
 * @module routes/root
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { appConfig } from "../config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8"));

/**
 * Root route plugin
 * @param {import('fastify').FastifyInstance} fastify - Fastify instance
 */
export async function rootRoute(fastify) {
  // Root endpoint - no auth required
  fastify.get("/", {
    schema: {
      description: "API information endpoint",
      tags: ["Info"],
      response: {
        200: {
          type: "object",
          properties: {
            name: { type: "string" },
            version: { type: "string" },
            description: { type: "string" },
            environment: { type: "string" },
            documentation: { type: "string" },
          },
        },
      },
    },
  }, async (_request, reply) => {
    return reply.send({
      name: pkg.name,
      version: pkg.version,
      description: pkg.description || "WhatsApp Web API",
      environment: appConfig.environment,
      documentation: "/docs",
    });
  });

  // Version endpoint
  fastify.get("/version", {
    schema: {
      description: "Get API version",
      tags: ["Info"],
      response: {
        200: {
          type: "object",
          properties: {
            version: { type: "string" },
            node_version: { type: "string" },
            environment: { type: "string" },
          },
        },
      },
    },
  }, async (_request, reply) => {
    return reply.send({
      version: pkg.version,
      node_version: process.version,
      environment: appConfig.environment,
    });
  });
}
