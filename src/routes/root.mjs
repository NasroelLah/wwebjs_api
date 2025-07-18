/* global process */
import { appConfig } from "../config.mjs";

export async function rootRoute(fastify) {
  // Root endpoint - no auth required
  fastify.get(
    "/",
    {
      schema: {
        description: "API information endpoint",
        tags: ['Info'],
        response: {
          200: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              version: { type: 'string' },
              description: { type: 'string' },
              environment: { type: 'string' },
              endpoints: {
                type: 'object',
                properties: {
                  message: { type: 'string' },
                  batch: { type: 'string' },
                  device: { type: 'array', items: { type: 'string' } },
                  health: { type: 'array', items: { type: 'string' } }
                }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
      return reply.send({
        name: "NAS WhatsApp API",
        version: "1.11.1",
        description: "Enterprise-grade REST API service for WhatsApp Web integration",
        environment: appConfig.environment,
        endpoints: {
          message: "POST /message - Send single message",
          batch: "POST /messages/batch - Send multiple messages",
          device: [
            "GET /device-status - Get device status",
            "GET /device-connect - Connect device (get QR)",
            "DELETE /device-remove - Remove device"
          ],
          health: [
            "GET /health - Full health check",
            "GET /health/live - Liveness probe",
            "GET /health/ready - Readiness probe"
          ]
        },
        authentication: "Bearer token required for message and device endpoints",
        documentation: "https://github.com/NasroelLah/wwebjs_api/wiki"
      });
    }
  );

  // API version endpoint
  fastify.get(
    "/version",
    {
      schema: {
        description: "Get API version",
        tags: ['Info'],
        response: {
          200: {
            type: 'object',
            properties: {
              version: { type: 'string' },
              node_version: { type: 'string' },
              environment: { type: 'string' }
            }
          }
        }
      }
    },
    async (request, reply) => {
      return reply.send({
        version: "1.11.1",
        node_version: process.version,
        environment: appConfig.environment
      });
    }
  );
}
