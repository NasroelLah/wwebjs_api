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

export async function messageActionsRoute(fastify) {
  fastify.addHook("preHandler", async (request, reply) => {
    validateApiKey(request, reply);
  });

  // Get message by ID
  fastify.get("/messages/:id", {
    schema: {
      description: "Get message by ID",
      tags: ["Messages"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    try {
      const message = await client.getMessageById(id);
      if (!message) {
        throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.NOT_FOUND, "Message not found", true);
      }
      return reply.send({
        status: "success",
        data: {
          id: message.id._serialized,
          body: message.body,
          type: message.type,
          timestamp: message.timestamp,
          from: message.from,
          to: message.to,
          fromMe: message.fromMe,
          hasMedia: message.hasMedia,
          hasQuotedMsg: message.hasQuotedMsg,
          isForwarded: message.isForwarded,
          isStarred: message.isStarred,
          ack: message.ack,
        },
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ error, messageId: id }, "Failed to get message");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.NOT_FOUND, "Message not found", true);
    }
  });

  // Reply to message
  fastify.post("/messages/:id/reply", {
    schema: {
      description: "Reply to a message",
      tags: ["Messages"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      body: {
        type: "object",
        required: ["content"],
        properties: {
          content: { type: "string" },
          chatId: { type: "string", description: "Optional: reply in different chat" },
        },
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    const { content, chatId } = request.body;
    try {
      const message = await client.getMessageById(id);
      if (!message) {
        throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.NOT_FOUND, "Message not found", true);
      }
      const sentMessage = await message.reply(content, chatId);
      logger.info({ messageId: id }, "Message replied");
      return reply.send({
        status: "success",
        message: "Reply sent",
        data: { id: sentMessage.id._serialized },
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ error, messageId: id }, "Failed to reply to message");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to reply to message", true);
    }
  });

  // React to message
  fastify.post("/messages/:id/react", {
    schema: {
      description: "React to a message with emoji",
      tags: ["Messages"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      body: {
        type: "object",
        required: ["emoji"],
        properties: {
          emoji: { type: "string", description: "Emoji to react with (empty string to remove)" },
        },
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    const { emoji } = request.body;
    try {
      const message = await client.getMessageById(id);
      if (!message) {
        throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.NOT_FOUND, "Message not found", true);
      }
      await message.react(emoji);
      logger.info({ messageId: id, emoji }, "Message reacted");
      return reply.send({ status: "success", message: emoji ? "Reaction added" : "Reaction removed" });
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ error, messageId: id }, "Failed to react to message");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to react to message", true);
    }
  });

  // Forward message
  fastify.post("/messages/:id/forward", {
    schema: {
      description: "Forward a message to another chat",
      tags: ["Messages"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      body: {
        type: "object",
        required: ["chatId"],
        properties: {
          chatId: { type: "string" },
        },
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    const { chatId } = request.body;
    const targetChatId = chatId.includes("@") ? chatId : `${chatId}@c.us`;
    try {
      const message = await client.getMessageById(id);
      if (!message) {
        throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.NOT_FOUND, "Message not found", true);
      }
      const forwardedMsg = await message.forward(targetChatId);
      logger.info({ messageId: id, targetChatId }, "Message forwarded");
      return reply.send({
        status: "success",
        message: "Message forwarded",
        data: { id: forwardedMsg.id._serialized },
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ error, messageId: id }, "Failed to forward message");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to forward message", true);
    }
  });

  // Delete message
  fastify.delete("/messages/:id", {
    schema: {
      description: "Delete a message",
      tags: ["Messages"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      querystring: {
        type: "object",
        properties: {
          everyone: { type: "boolean", default: false, description: "Delete for everyone" },
        },
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    const { everyone = false } = request.query;
    try {
      const message = await client.getMessageById(id);
      if (!message) {
        throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.NOT_FOUND, "Message not found", true);
      }
      await message.delete(everyone);
      logger.info({ messageId: id, everyone }, "Message deleted");
      return reply.send({ status: "success", message: everyone ? "Message deleted for everyone" : "Message deleted" });
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ error, messageId: id }, "Failed to delete message");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to delete message", true);
    }
  });

  // Edit message
  fastify.put("/messages/:id", {
    schema: {
      description: "Edit a message",
      tags: ["Messages"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      body: {
        type: "object",
        required: ["content"],
        properties: {
          content: { type: "string" },
        },
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    const { content } = request.body;
    try {
      const message = await client.getMessageById(id);
      if (!message) {
        throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.NOT_FOUND, "Message not found", true);
      }
      const editedMsg = await message.edit(content);
      logger.info({ messageId: id }, "Message edited");
      return reply.send({
        status: "success",
        message: "Message edited",
        data: editedMsg ? { id: editedMsg.id._serialized } : null,
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ error, messageId: id }, "Failed to edit message");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to edit message", true);
    }
  });

  // Star message
  fastify.post("/messages/:id/star", {
    schema: {
      description: "Star a message",
      tags: ["Messages"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    try {
      const message = await client.getMessageById(id);
      if (!message) {
        throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.NOT_FOUND, "Message not found", true);
      }
      await message.star();
      logger.info({ messageId: id }, "Message starred");
      return reply.send({ status: "success", message: "Message starred" });
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ error, messageId: id }, "Failed to star message");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to star message", true);
    }
  });

  // Unstar message
  fastify.post("/messages/:id/unstar", {
    schema: {
      description: "Unstar a message",
      tags: ["Messages"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    try {
      const message = await client.getMessageById(id);
      if (!message) {
        throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.NOT_FOUND, "Message not found", true);
      }
      await message.unstar();
      logger.info({ messageId: id }, "Message unstarred");
      return reply.send({ status: "success", message: "Message unstarred" });
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ error, messageId: id }, "Failed to unstar message");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to unstar message", true);
    }
  });

  // Pin message
  fastify.post("/messages/:id/pin", {
    schema: {
      description: "Pin a message",
      tags: ["Messages"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: {
          duration: { type: "number", default: 604800, description: "Duration in seconds (default: 7 days)" },
        },
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    const { duration = 604800 } = request.body || {};
    try {
      const message = await client.getMessageById(id);
      if (!message) {
        throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.NOT_FOUND, "Message not found", true);
      }
      await message.pin(duration);
      logger.info({ messageId: id, duration }, "Message pinned");
      return reply.send({ status: "success", message: "Message pinned" });
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ error, messageId: id }, "Failed to pin message");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to pin message", true);
    }
  });

  // Unpin message
  fastify.post("/messages/:id/unpin", {
    schema: {
      description: "Unpin a message",
      tags: ["Messages"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    try {
      const message = await client.getMessageById(id);
      if (!message) {
        throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.NOT_FOUND, "Message not found", true);
      }
      await message.unpin();
      logger.info({ messageId: id }, "Message unpinned");
      return reply.send({ status: "success", message: "Message unpinned" });
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ error, messageId: id }, "Failed to unpin message");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to unpin message", true);
    }
  });

  // Download media from message
  fastify.get("/messages/:id/media", {
    schema: {
      description: "Download media from message",
      tags: ["Messages"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    try {
      const message = await client.getMessageById(id);
      if (!message) {
        throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.NOT_FOUND, "Message not found", true);
      }
      if (!message.hasMedia) {
        throw new AppError(ErrorTypes.VALIDATION_ERROR, HttpStatusCodes.BAD_REQUEST, "Message has no media", true);
      }
      const media = await message.downloadMedia();
      return reply.send({
        status: "success",
        data: {
          mimetype: media.mimetype,
          filename: media.filename || null,
          data: media.data, // base64
        },
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ error, messageId: id }, "Failed to download media");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to download media", true);
    }
  });

  // Get quoted message
  fastify.get("/messages/:id/quoted", {
    schema: {
      description: "Get the quoted/replied message",
      tags: ["Messages"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    try {
      const message = await client.getMessageById(id);
      if (!message) {
        throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.NOT_FOUND, "Message not found", true);
      }
      if (!message.hasQuotedMsg) {
        throw new AppError(ErrorTypes.VALIDATION_ERROR, HttpStatusCodes.BAD_REQUEST, "Message has no quoted message", true);
      }
      const quotedMsg = await message.getQuotedMessage();
      return reply.send({
        status: "success",
        data: {
          id: quotedMsg.id._serialized,
          body: quotedMsg.body,
          type: quotedMsg.type,
          timestamp: quotedMsg.timestamp,
          from: quotedMsg.from,
          fromMe: quotedMsg.fromMe,
        },
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ error, messageId: id }, "Failed to get quoted message");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to get quoted message", true);
    }
  });

  // Get message reactions
  fastify.get("/messages/:id/reactions", {
    schema: {
      description: "Get reactions on a message",
      tags: ["Messages"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    try {
      const message = await client.getMessageById(id);
      if (!message) {
        throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.NOT_FOUND, "Message not found", true);
      }
      const reactions = await message.getReactions();
      return reply.send({
        status: "success",
        data: reactions || [],
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ error, messageId: id }, "Failed to get reactions");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to get reactions", true);
    }
  });

  // Get message info (read/delivered status)
  fastify.get("/messages/:id/info", {
    schema: {
      description: "Get message info (delivery/read status)",
      tags: ["Messages"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    try {
      const message = await client.getMessageById(id);
      if (!message) {
        throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.NOT_FOUND, "Message not found", true);
      }
      const info = await message.getInfo();
      return reply.send({
        status: "success",
        data: info,
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ error, messageId: id }, "Failed to get message info");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to get message info", true);
    }
  });
}
