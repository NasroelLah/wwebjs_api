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
        version: "1.13.0",
        description: "REST API for WhatsApp Web integration",
        environment: appConfig.environment,
        endpoints: {
          messages: [
            "POST /message - Send message",
            "POST /messages/batch - Batch send",
            "GET /messages/:id - Get message",
            "POST /messages/:id/reply - Reply",
            "POST /messages/:id/react - React",
            "POST /messages/:id/forward - Forward",
            "PUT /messages/:id - Edit",
            "DELETE /messages/:id - Delete"
          ],
          contacts: [
            "GET /contacts - List contacts",
            "GET /contacts/:id - Get contact",
            "GET /contacts/:id/picture - Profile pic",
            "POST /contacts/:id/block - Block",
            "POST /contacts/:id/unblock - Unblock"
          ],
          chats: [
            "GET /chats - List chats",
            "GET /chats/:id - Get chat",
            "GET /chats/:id/messages - Get messages",
            "POST /chats/:id/archive - Archive",
            "POST /chats/:id/pin - Pin",
            "POST /chats/:id/mute - Mute",
            "DELETE /chats/:id - Delete"
          ],
          groups: [
            "POST /groups - Create group",
            "GET /groups/:id - Get info",
            "PUT /groups/:id/subject - Update name",
            "GET /groups/:id/invite-code - Get invite",
            "POST /groups/:id/participants/add - Add members",
            "POST /groups/:id/participants/remove - Remove",
            "POST /groups/:id/leave - Leave"
          ],
          device: [
            "GET /device-status - Status",
            "GET /device-connect - Connect (QR)",
            "DELETE /device-remove - Remove"
          ],
          health: [
            "GET /health - Health check",
            "GET /health/live - Liveness",
            "GET /health/ready - Readiness"
          ]
        },
        authentication: "Bearer token required",
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
        version: "1.13.0",
        node_version: process.version,
        environment: appConfig.environment
      });
    }
  );
}
