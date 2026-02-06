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

export async function groupRoute(fastify) {
  fastify.addHook("preHandler", async (request, reply) => {
    validateApiKey(request, reply);
  });

  // Create group
  fastify.post("/groups", {
    schema: {
      description: "Create a new group",
      tags: ["Groups"],
      body: {
        type: "object",
        required: ["name", "participants"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 100 },
          participants: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
          },
        },
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { name, participants } = request.body;
    try {
      const participantIds = participants.map((p) =>
        p.includes("@") ? p : `${p}@c.us`
      );
      const result = await client.createGroup(name, participantIds);
      logger.info({ groupId: result.gid._serialized, name }, "Group created");
      return reply.send({
        status: "success",
        message: "Group created",
        data: {
          id: result.gid._serialized,
          name,
          participants: result.participants || [],
        },
      });
    } catch (error) {
      logger.error({ error, name }, "Failed to create group");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to create group", true);
    }
  });

  // Get group info
  fastify.get("/groups/:id", {
    schema: {
      description: "Get group info",
      tags: ["Groups"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    const groupId = id.includes("@") ? id : `${id}@g.us`;
    try {
      const chat = await client.getChatById(groupId);
      if (!chat.isGroup) {
        throw new AppError(ErrorTypes.VALIDATION_ERROR, HttpStatusCodes.BAD_REQUEST, "Not a group chat", true);
      }
      return reply.send({
        status: "success",
        data: {
          id: chat.id._serialized,
          name: chat.name,
          description: chat.groupMetadata?.desc || null,
          owner: chat.owner?._serialized || null,
          createdAt: chat.groupMetadata?.creation || null,
          participants: chat.participants?.map((p) => ({
            id: p.id._serialized,
            isAdmin: p.isAdmin,
            isSuperAdmin: p.isSuperAdmin,
          })) || [],
          participantCount: chat.participants?.length || 0,
        },
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ error, groupId }, "Failed to get group info");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.NOT_FOUND, "Group not found", true);
    }
  });

  // Update group subject (name)
  fastify.put("/groups/:id/subject", {
    schema: {
      description: "Update group name",
      tags: ["Groups"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      body: {
        type: "object",
        required: ["subject"],
        properties: {
          subject: { type: "string", minLength: 1, maxLength: 100 },
        },
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    const { subject } = request.body;
    const groupId = id.includes("@") ? id : `${id}@g.us`;
    try {
      const chat = await client.getChatById(groupId);
      await chat.setSubject(subject);
      logger.info({ groupId, subject }, "Group subject updated");
      return reply.send({ status: "success", message: "Group subject updated" });
    } catch (error) {
      logger.error({ error, groupId }, "Failed to update group subject");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to update group subject", true);
    }
  });

  // Update group description
  fastify.put("/groups/:id/description", {
    schema: {
      description: "Update group description",
      tags: ["Groups"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      body: {
        type: "object",
        required: ["description"],
        properties: {
          description: { type: "string", maxLength: 512 },
        },
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    const { description } = request.body;
    const groupId = id.includes("@") ? id : `${id}@g.us`;
    try {
      const chat = await client.getChatById(groupId);
      const success = await chat.setDescription(description);
      if (!success) {
        throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.FORBIDDEN, "No permission to update description", true);
      }
      logger.info({ groupId }, "Group description updated");
      return reply.send({ status: "success", message: "Group description updated" });
    } catch (error) {
      if (error instanceof AppError) throw error;
      logger.error({ error, groupId }, "Failed to update group description");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to update group description", true);
    }
  });

  // Get invite code
  fastify.get("/groups/:id/invite-code", {
    schema: {
      description: "Get group invite code/link",
      tags: ["Groups"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    const groupId = id.includes("@") ? id : `${id}@g.us`;
    try {
      const chat = await client.getChatById(groupId);
      const code = await chat.getInviteCode();
      return reply.send({
        status: "success",
        data: {
          code,
          link: `https://chat.whatsapp.com/${code}`,
        },
      });
    } catch (error) {
      logger.error({ error, groupId }, "Failed to get invite code");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to get invite code", true);
    }
  });

  // Revoke invite code
  fastify.post("/groups/:id/revoke-invite", {
    schema: {
      description: "Revoke group invite code and generate new one",
      tags: ["Groups"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    const groupId = id.includes("@") ? id : `${id}@g.us`;
    try {
      const chat = await client.getChatById(groupId);
      const newCode = await chat.revokeInvite();
      logger.info({ groupId }, "Group invite code revoked");
      return reply.send({
        status: "success",
        message: "Invite code revoked",
        data: {
          code: newCode,
          link: `https://chat.whatsapp.com/${newCode}`,
        },
      });
    } catch (error) {
      logger.error({ error, groupId }, "Failed to revoke invite code");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to revoke invite code", true);
    }
  });

  // Add participants
  fastify.post("/groups/:id/participants/add", {
    schema: {
      description: "Add participants to group",
      tags: ["Groups"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      body: {
        type: "object",
        required: ["participants"],
        properties: {
          participants: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
          },
        },
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    const { participants } = request.body;
    const groupId = id.includes("@") ? id : `${id}@g.us`;
    try {
      const chat = await client.getChatById(groupId);
      const participantIds = participants.map((p) =>
        p.includes("@") ? p : `${p}@c.us`
      );
      const result = await chat.addParticipants(participantIds);
      logger.info({ groupId, participants: participantIds }, "Participants added");
      return reply.send({
        status: "success",
        message: "Participants added",
        data: result,
      });
    } catch (error) {
      logger.error({ error, groupId }, "Failed to add participants");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to add participants", true);
    }
  });

  // Remove participants
  fastify.post("/groups/:id/participants/remove", {
    schema: {
      description: "Remove participants from group",
      tags: ["Groups"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      body: {
        type: "object",
        required: ["participants"],
        properties: {
          participants: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
          },
        },
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    const { participants } = request.body;
    const groupId = id.includes("@") ? id : `${id}@g.us`;
    try {
      const chat = await client.getChatById(groupId);
      const participantIds = participants.map((p) =>
        p.includes("@") ? p : `${p}@c.us`
      );
      await chat.removeParticipants(participantIds);
      logger.info({ groupId, participants: participantIds }, "Participants removed");
      return reply.send({ status: "success", message: "Participants removed" });
    } catch (error) {
      logger.error({ error, groupId }, "Failed to remove participants");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to remove participants", true);
    }
  });

  // Promote participants to admin
  fastify.post("/groups/:id/participants/promote", {
    schema: {
      description: "Promote participants to admin",
      tags: ["Groups"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      body: {
        type: "object",
        required: ["participants"],
        properties: {
          participants: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
          },
        },
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    const { participants } = request.body;
    const groupId = id.includes("@") ? id : `${id}@g.us`;
    try {
      const chat = await client.getChatById(groupId);
      const participantIds = participants.map((p) =>
        p.includes("@") ? p : `${p}@c.us`
      );
      await chat.promoteParticipants(participantIds);
      logger.info({ groupId, participants: participantIds }, "Participants promoted");
      return reply.send({ status: "success", message: "Participants promoted to admin" });
    } catch (error) {
      logger.error({ error, groupId }, "Failed to promote participants");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to promote participants", true);
    }
  });

  // Demote participants from admin
  fastify.post("/groups/:id/participants/demote", {
    schema: {
      description: "Demote participants from admin",
      tags: ["Groups"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      body: {
        type: "object",
        required: ["participants"],
        properties: {
          participants: {
            type: "array",
            items: { type: "string" },
            minItems: 1,
          },
        },
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    const { participants } = request.body;
    const groupId = id.includes("@") ? id : `${id}@g.us`;
    try {
      const chat = await client.getChatById(groupId);
      const participantIds = participants.map((p) =>
        p.includes("@") ? p : `${p}@c.us`
      );
      await chat.demoteParticipants(participantIds);
      logger.info({ groupId, participants: participantIds }, "Participants demoted");
      return reply.send({ status: "success", message: "Participants demoted from admin" });
    } catch (error) {
      logger.error({ error, groupId }, "Failed to demote participants");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to demote participants", true);
    }
  });

  // Leave group
  fastify.post("/groups/:id/leave", {
    schema: {
      description: "Leave a group",
      tags: ["Groups"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    const groupId = id.includes("@") ? id : `${id}@g.us`;
    try {
      const chat = await client.getChatById(groupId);
      await chat.leave();
      logger.info({ groupId }, "Left group");
      return reply.send({ status: "success", message: "Left group" });
    } catch (error) {
      logger.error({ error, groupId }, "Failed to leave group");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to leave group", true);
    }
  });

  // Get membership requests
  fastify.get("/groups/:id/membership-requests", {
    schema: {
      description: "Get pending membership requests",
      tags: ["Groups"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    const groupId = id.includes("@") ? id : `${id}@g.us`;
    try {
      const chat = await client.getChatById(groupId);
      const requests = await chat.getGroupMembershipRequests();
      return reply.send({
        status: "success",
        data: requests.map((r) => ({
          id: r.id._serialized,
          timestamp: r.t,
        })),
      });
    } catch (error) {
      logger.error({ error, groupId }, "Failed to get membership requests");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to get membership requests", true);
    }
  });

  // Approve membership requests
  fastify.post("/groups/:id/membership-requests/approve", {
    schema: {
      description: "Approve membership requests",
      tags: ["Groups"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: {
          requesters: {
            type: "array",
            items: { type: "string" },
            description: "IDs to approve (omit for all)",
          },
        },
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    const { requesters } = request.body || {};
    const groupId = id.includes("@") ? id : `${id}@g.us`;
    try {
      const chat = await client.getChatById(groupId);
      const options = requesters ? { requesterIds: requesters } : {};
      const result = await chat.approveGroupMembershipRequests(options);
      logger.info({ groupId }, "Membership requests approved");
      return reply.send({ status: "success", message: "Requests approved", data: result });
    } catch (error) {
      logger.error({ error, groupId }, "Failed to approve requests");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to approve requests", true);
    }
  });

  // Reject membership requests
  fastify.post("/groups/:id/membership-requests/reject", {
    schema: {
      description: "Reject membership requests",
      tags: ["Groups"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: {
          requesters: {
            type: "array",
            items: { type: "string" },
            description: "IDs to reject (omit for all)",
          },
        },
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    const { requesters } = request.body || {};
    const groupId = id.includes("@") ? id : `${id}@g.us`;
    try {
      const chat = await client.getChatById(groupId);
      const options = requesters ? { requesterIds: requesters } : {};
      const result = await chat.rejectGroupMembershipRequests(options);
      logger.info({ groupId }, "Membership requests rejected");
      return reply.send({ status: "success", message: "Requests rejected", data: result });
    } catch (error) {
      logger.error({ error, groupId }, "Failed to reject requests");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to reject requests", true);
    }
  });

  // Update group settings
  fastify.put("/groups/:id/settings", {
    schema: {
      description: "Update group settings",
      tags: ["Groups"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: {
          messagesAdminsOnly: { type: "boolean" },
          infoAdminsOnly: { type: "boolean" },
          addMembersAdminsOnly: { type: "boolean" },
        },
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    const { messagesAdminsOnly, infoAdminsOnly, addMembersAdminsOnly } = request.body;
    const groupId = id.includes("@") ? id : `${id}@g.us`;
    try {
      const chat = await client.getChatById(groupId);
      if (messagesAdminsOnly !== undefined) {
        await chat.setMessagesAdminsOnly(messagesAdminsOnly);
      }
      if (infoAdminsOnly !== undefined) {
        await chat.setInfoAdminsOnly(infoAdminsOnly);
      }
      if (addMembersAdminsOnly !== undefined) {
        await chat.setAddMembersAdminsOnly(addMembersAdminsOnly);
      }
      logger.info({ groupId }, "Group settings updated");
      return reply.send({ status: "success", message: "Group settings updated" });
    } catch (error) {
      logger.error({ error, groupId }, "Failed to update group settings");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to update group settings", true);
    }
  });
}
