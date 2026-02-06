/**
 * @fileoverview Chat Routes - API endpoints for chat operations
 * @module routes/chat
 */

import { validateApiKey } from "../middleware/auth.mjs";
import * as chatController from "../controllers/chatController.mjs";

/**
 * Chat route plugin
 * @param {import('fastify').FastifyInstance} fastify - Fastify instance
 */
export async function chatRoute(fastify) {
  fastify.addHook("preHandler", async (request, reply) => {
    validateApiKey(request, reply);
  });

  // Get all chats
  fastify.get("/chats", {
    schema: {
      description: "Get all chats",
      tags: ["Chats"],
    },
  }, async (request, reply) => {
    const data = await chatController.getAllChats();
    return reply.send({ status: "success", data });
  });

  // Get chat by ID
  fastify.get("/chats/:id", {
    schema: {
      description: "Get chat by ID",
      tags: ["Chats"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    const data = await chatController.getChatById(request.params.id);
    return reply.send({ status: "success", data });
  });

  // Get messages from chat
  fastify.get("/chats/:id/messages", {
    schema: {
      description: "Get messages from chat",
      tags: ["Chats"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      querystring: {
        type: "object",
        properties: {
          limit: { type: "number", default: 50 },
        },
      },
    },
  }, async (request, reply) => {
    const data = await chatController.fetchMessages(
      request.params.id,
      request.query.limit
    );
    return reply.send({ status: "success", data });
  });

  // Archive chat
  fastify.post("/chats/:id/archive", {
    schema: {
      description: "Archive a chat",
      tags: ["Chats"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    await chatController.archiveChat(request.params.id);
    return reply.send({ status: "success", message: "Chat archived" });
  });

  // Unarchive chat
  fastify.post("/chats/:id/unarchive", {
    schema: {
      description: "Unarchive a chat",
      tags: ["Chats"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    await chatController.unarchiveChat(request.params.id);
    return reply.send({ status: "success", message: "Chat unarchived" });
  });

  // Pin chat
  fastify.post("/chats/:id/pin", {
    schema: {
      description: "Pin a chat (max 3)",
      tags: ["Chats"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    const pinned = await chatController.pinChat(request.params.id);
    return reply.send({ status: "success", data: { pinned } });
  });

  // Unpin chat
  fastify.post("/chats/:id/unpin", {
    schema: {
      description: "Unpin a chat",
      tags: ["Chats"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    await chatController.unpinChat(request.params.id);
    return reply.send({ status: "success", message: "Chat unpinned" });
  });

  // Mute chat
  fastify.post("/chats/:id/mute", {
    schema: {
      description: "Mute a chat",
      tags: ["Chats"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: {
          duration: { type: "number", description: "Duration in seconds" },
        },
      },
    },
  }, async (request, reply) => {
    await chatController.muteChat(request.params.id, request.body?.duration);
    return reply.send({ status: "success", message: "Chat muted" });
  });

  // Unmute chat
  fastify.post("/chats/:id/unmute", {
    schema: {
      description: "Unmute a chat",
      tags: ["Chats"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    await chatController.unmuteChat(request.params.id);
    return reply.send({ status: "success", message: "Chat unmuted" });
  });

  // Mark as read
  fastify.post("/chats/:id/read", {
    schema: {
      description: "Mark chat as read",
      tags: ["Chats"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    await chatController.markAsRead(request.params.id);
    return reply.send({ status: "success", message: "Chat marked as read" });
  });

  // Mark as unread
  fastify.post("/chats/:id/unread", {
    schema: {
      description: "Mark chat as unread",
      tags: ["Chats"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    await chatController.markAsUnread(request.params.id);
    return reply.send({ status: "success", message: "Chat marked as unread" });
  });

  // Delete chat
  fastify.delete("/chats/:id", {
    schema: {
      description: "Delete a chat",
      tags: ["Chats"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    await chatController.deleteChat(request.params.id);
    return reply.send({ status: "success", message: "Chat deleted" });
  });

  // Clear chat
  fastify.post("/chats/:id/clear", {
    schema: {
      description: "Clear all messages in a chat",
      tags: ["Chats"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    await chatController.clearChat(request.params.id);
    return reply.send({ status: "success", message: "Chat cleared" });
  });

  // Send typing indicator
  fastify.post("/chats/:id/typing", {
    schema: {
      description: "Send typing indicator",
      tags: ["Chats"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    await chatController.sendTyping(request.params.id);
    return reply.send({ status: "success", message: "Typing indicator sent" });
  });

  // Send recording indicator
  fastify.post("/chats/:id/recording", {
    schema: {
      description: "Send recording indicator",
      tags: ["Chats"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    await chatController.sendRecording(request.params.id);
    return reply.send({ status: "success", message: "Recording indicator sent" });
  });
}
