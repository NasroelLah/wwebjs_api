import { validateApiKey } from "../middleware/auth.mjs";
import { client, isClientReady } from "../whatsappClient.mjs";
import logger from "../logger.mjs";
import { AppError, ErrorTypes, HttpStatusCodes } from "../errors/AppError.mjs";

function ensureClientReady() {
  if (!isClientReady()) {
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.SERVICE_UNAVAILABLE,
      "WhatsApp client is not ready",
      true
    );
  }
}

export async function chatRoute(fastify) {
  fastify.addHook("preHandler", async (request, reply) => {
    validateApiKey(request, reply);
  });

  // Get all chats
  fastify.get("/chats", {
    schema: {
      description: "Get all chats",
      tags: ["Chats"],
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "string" },
            data: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  isGroup: { type: "boolean" },
                  isReadOnly: { type: "boolean" },
                  unreadCount: { type: "number" },
                  timestamp: { type: "number" },
                  pinned: { type: "boolean" },
                  archived: { type: "boolean" },
                  isMuted: { type: "boolean" },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    try {
      const chats = await client.getChats();
      const data = chats.map((c) => ({
        id: c.id._serialized,
        name: c.name,
        isGroup: c.isGroup,
        isReadOnly: c.isReadOnly,
        unreadCount: c.unreadCount,
        timestamp: c.timestamp,
        pinned: c.pinned,
        archived: c.archived,
        isMuted: c.isMuted,
      }));
      return reply.send({ status: "success", data });
    } catch (error) {
      logger.error({ error }, "Failed to get chats");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to get chats", true);
    }
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
    ensureClientReady();
    const { id } = request.params;
    const chatId = id.includes("@") ? id : `${id}@c.us`;
    try {
      const chat = await client.getChatById(chatId);
      return reply.send({
        status: "success",
        data: {
          id: chat.id._serialized,
          name: chat.name,
          isGroup: chat.isGroup,
          isReadOnly: chat.isReadOnly,
          unreadCount: chat.unreadCount,
          timestamp: chat.timestamp,
          pinned: chat.pinned,
          archived: chat.archived,
          isMuted: chat.isMuted,
          lastMessage: chat.lastMessage ? {
            body: chat.lastMessage.body,
            timestamp: chat.lastMessage.timestamp,
            fromMe: chat.lastMessage.fromMe,
          } : null,
        },
      });
    } catch (error) {
      logger.error({ error, chatId }, "Failed to get chat");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.NOT_FOUND, "Chat not found", true);
    }
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
    ensureClientReady();
    const { id } = request.params;
    const { limit = 50 } = request.query;
    const chatId = id.includes("@") ? id : `${id}@c.us`;
    try {
      const chat = await client.getChatById(chatId);
      const messages = await chat.fetchMessages({ limit: Math.min(limit, 100) });
      const data = messages.map((m) => ({
        id: m.id._serialized,
        body: m.body,
        type: m.type,
        timestamp: m.timestamp,
        fromMe: m.fromMe,
        author: m.author || null,
        hasMedia: m.hasMedia,
        isForwarded: m.isForwarded,
        isStarred: m.isStarred,
      }));
      return reply.send({ status: "success", data });
    } catch (error) {
      logger.error({ error, chatId }, "Failed to fetch messages");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to fetch messages", true);
    }
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
    ensureClientReady();
    const { id } = request.params;
    const chatId = id.includes("@") ? id : `${id}@c.us`;
    try {
      const chat = await client.getChatById(chatId);
      await chat.archive();
      logger.info({ chatId }, "Chat archived");
      return reply.send({ status: "success", message: "Chat archived" });
    } catch (error) {
      logger.error({ error, chatId }, "Failed to archive chat");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to archive chat", true);
    }
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
    ensureClientReady();
    const { id } = request.params;
    const chatId = id.includes("@") ? id : `${id}@c.us`;
    try {
      const chat = await client.getChatById(chatId);
      await chat.unarchive();
      logger.info({ chatId }, "Chat unarchived");
      return reply.send({ status: "success", message: "Chat unarchived" });
    } catch (error) {
      logger.error({ error, chatId }, "Failed to unarchive chat");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to unarchive chat", true);
    }
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
    ensureClientReady();
    const { id } = request.params;
    const chatId = id.includes("@") ? id : `${id}@c.us`;
    try {
      const chat = await client.getChatById(chatId);
      const pinned = await chat.pin();
      logger.info({ chatId, pinned }, "Chat pin toggled");
      return reply.send({ status: "success", data: { pinned } });
    } catch (error) {
      logger.error({ error, chatId }, "Failed to pin chat");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to pin chat", true);
    }
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
    ensureClientReady();
    const { id } = request.params;
    const chatId = id.includes("@") ? id : `${id}@c.us`;
    try {
      const chat = await client.getChatById(chatId);
      await chat.unpin();
      logger.info({ chatId }, "Chat unpinned");
      return reply.send({ status: "success", message: "Chat unpinned" });
    } catch (error) {
      logger.error({ error, chatId }, "Failed to unpin chat");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to unpin chat", true);
    }
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
          duration: { type: "number", description: "Duration in seconds (optional, omit for forever)" },
        },
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    const { duration } = request.body || {};
    const chatId = id.includes("@") ? id : `${id}@c.us`;
    try {
      const chat = await client.getChatById(chatId);
      const unmuteDate = duration ? new Date(Date.now() + duration * 1000) : undefined;
      await chat.mute(unmuteDate);
      logger.info({ chatId, duration }, "Chat muted");
      return reply.send({ status: "success", message: "Chat muted" });
    } catch (error) {
      logger.error({ error, chatId }, "Failed to mute chat");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to mute chat", true);
    }
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
    ensureClientReady();
    const { id } = request.params;
    const chatId = id.includes("@") ? id : `${id}@c.us`;
    try {
      const chat = await client.getChatById(chatId);
      await chat.unmute();
      logger.info({ chatId }, "Chat unmuted");
      return reply.send({ status: "success", message: "Chat unmuted" });
    } catch (error) {
      logger.error({ error, chatId }, "Failed to unmute chat");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to unmute chat", true);
    }
  });

  // Mark chat as read
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
    ensureClientReady();
    const { id } = request.params;
    const chatId = id.includes("@") ? id : `${id}@c.us`;
    try {
      const chat = await client.getChatById(chatId);
      await chat.sendSeen();
      logger.info({ chatId }, "Chat marked as read");
      return reply.send({ status: "success", message: "Chat marked as read" });
    } catch (error) {
      logger.error({ error, chatId }, "Failed to mark chat as read");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to mark chat as read", true);
    }
  });

  // Mark chat as unread
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
    ensureClientReady();
    const { id } = request.params;
    const chatId = id.includes("@") ? id : `${id}@c.us`;
    try {
      const chat = await client.getChatById(chatId);
      await chat.markUnread();
      logger.info({ chatId }, "Chat marked as unread");
      return reply.send({ status: "success", message: "Chat marked as unread" });
    } catch (error) {
      logger.error({ error, chatId }, "Failed to mark chat as unread");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to mark chat as unread", true);
    }
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
    ensureClientReady();
    const { id } = request.params;
    const chatId = id.includes("@") ? id : `${id}@c.us`;
    try {
      const chat = await client.getChatById(chatId);
      await chat.delete();
      logger.info({ chatId }, "Chat deleted");
      return reply.send({ status: "success", message: "Chat deleted" });
    } catch (error) {
      logger.error({ error, chatId }, "Failed to delete chat");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to delete chat", true);
    }
  });

  // Clear chat messages
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
    ensureClientReady();
    const { id } = request.params;
    const chatId = id.includes("@") ? id : `${id}@c.us`;
    try {
      const chat = await client.getChatById(chatId);
      await chat.clearMessages();
      logger.info({ chatId }, "Chat messages cleared");
      return reply.send({ status: "success", message: "Chat messages cleared" });
    } catch (error) {
      logger.error({ error, chatId }, "Failed to clear chat");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to clear chat", true);
    }
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
    ensureClientReady();
    const { id } = request.params;
    const chatId = id.includes("@") ? id : `${id}@c.us`;
    try {
      const chat = await client.getChatById(chatId);
      await chat.sendStateTyping();
      return reply.send({ status: "success", message: "Typing indicator sent" });
    } catch (error) {
      logger.error({ error, chatId }, "Failed to send typing indicator");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to send typing indicator", true);
    }
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
    ensureClientReady();
    const { id } = request.params;
    const chatId = id.includes("@") ? id : `${id}@c.us`;
    try {
      const chat = await client.getChatById(chatId);
      await chat.sendStateRecording();
      return reply.send({ status: "success", message: "Recording indicator sent" });
    } catch (error) {
      logger.error({ error, chatId }, "Failed to send recording indicator");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to send recording indicator", true);
    }
  });
}
