import { validateApiKey } from "../middleware/auth.mjs";
import { llmConfig } from "../config.mjs";
import { getLLMInfo, isLLMConfigured } from "../helpers/llmHelper.mjs";
import {
  getConversationHistory,
  clearConversation,
  clearOldConversations,
  getConversationStats,
  getRateLimitInfo,
  initConversationTable,
} from "../helpers/conversationHelper.mjs";
import logger from "../logger.mjs";
import { AppError, ErrorTypes, HttpStatusCodes } from "../errors/AppError.mjs";

// Initialize conversation table on module load
initConversationTable();

export async function autoResponseRoute(fastify) {
  fastify.addHook("preHandler", async (request, reply) => {
    validateApiKey(request, reply);
  });

  // Get auto-response status and config
  fastify.get("/auto-response/status", {
    schema: {
      description: "Get auto-response status and configuration",
      tags: ["Auto-Response"],
    },
  }, async (request, reply) => {
    const llmInfo = getLLMInfo();
    const stats = await getConversationStats();

    return reply.send({
      status: "success",
      data: {
        enabled: llmConfig.enabled,
        configured: isLLMConfigured(),
        provider: llmInfo.provider,
        model: llmInfo.model,
        settings: {
          triggerMode: llmConfig.triggerMode,
          triggerPrefix: llmConfig.triggerPrefix,
          excludeGroups: llmConfig.excludeGroups,
          excludeChannels: llmConfig.excludeChannels,
          rateLimit: llmConfig.rateLimit,
          historyLimit: llmConfig.historyLimit,
        },
        stats: stats || {},
      },
    });
  });

  // Get conversation history for a contact
  fastify.get("/auto-response/conversations/:contactId", {
    schema: {
      description: "Get conversation history for a contact",
      tags: ["Auto-Response"],
      params: {
        type: "object",
        properties: { contactId: { type: "string" } },
        required: ["contactId"],
      },
      querystring: {
        type: "object",
        properties: {
          limit: { type: "number", default: 20 },
        },
      },
    },
  }, async (request, reply) => {
    const { contactId } = request.params;
    const { limit = 20 } = request.query;

    const history = await getConversationHistory(contactId, limit);
    const rateLimit = getRateLimitInfo(contactId);

    return reply.send({
      status: "success",
      data: {
        contactId,
        messageCount: history.length,
        messages: history,
        rateLimit,
      },
    });
  });

  // Clear conversation history for a contact
  fastify.delete("/auto-response/conversations/:contactId", {
    schema: {
      description: "Clear conversation history for a contact",
      tags: ["Auto-Response"],
      params: {
        type: "object",
        properties: { contactId: { type: "string" } },
        required: ["contactId"],
      },
    },
  }, async (request, reply) => {
    const { contactId } = request.params;

    const deleted = await clearConversation(contactId);
    logger.info({ contactId, deleted }, "Conversation cleared via API");

    return reply.send({
      status: "success",
      message: `Cleared ${deleted} messages`,
      data: { contactId, deleted },
    });
  });

  // Clear old conversations
  fastify.post("/auto-response/conversations/cleanup", {
    schema: {
      description: "Clear old conversation history",
      tags: ["Auto-Response"],
      body: {
        type: "object",
        properties: {
          daysOld: { type: "number", default: 7 },
        },
      },
    },
  }, async (request, reply) => {
    const { daysOld = 7 } = request.body || {};

    const deleted = await clearOldConversations(daysOld);
    logger.info({ daysOld, deleted }, "Old conversations cleaned up");

    return reply.send({
      status: "success",
      message: `Cleared ${deleted} old messages`,
      data: { daysOld, deleted },
    });
  });

  // Get all conversation stats
  fastify.get("/auto-response/stats", {
    schema: {
      description: "Get conversation statistics",
      tags: ["Auto-Response"],
    },
  }, async (request, reply) => {
    const stats = await getConversationStats();

    if (!stats) {
      throw new AppError(
        ErrorTypes.DATABASE_ERROR,
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        "Failed to get stats",
        true
      );
    }

    return reply.send({
      status: "success",
      data: stats,
    });
  });

  // Test LLM connection
  fastify.post("/auto-response/test", {
    schema: {
      description: "Test LLM connection with a sample message",
      tags: ["Auto-Response"],
      body: {
        type: "object",
        properties: {
          message: { type: "string", default: "Hello, how are you?" },
        },
      },
    },
  }, async (request, reply) => {
    if (!isLLMConfigured()) {
      throw new AppError(
        ErrorTypes.CONFIGURATION_ERROR,
        HttpStatusCodes.BAD_REQUEST,
        "LLM not configured. Set LLM_ENABLED, LLM_PROVIDER, and LLM_API_KEY.",
        true
      );
    }

    const { message = "Hello, how are you?" } = request.body || {};

    // Dynamic import to avoid circular dependency
    const { generateResponse } = await import("../helpers/llmHelper.mjs");
    
    const startTime = Date.now();
    const response = await generateResponse(
      [{ role: "user", content: message }],
      "Test User"
    );
    const duration = Date.now() - startTime;

    if (!response) {
      throw new AppError(
        ErrorTypes.WHATSAPP_ERROR,
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        "LLM failed to generate response",
        true
      );
    }

    return reply.send({
      status: "success",
      data: {
        input: message,
        output: response,
        provider: llmConfig.provider,
        model: llmConfig.model,
        durationMs: duration,
      },
    });
  });
}
