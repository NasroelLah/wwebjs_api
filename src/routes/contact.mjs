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

export async function contactRoute(fastify) {
  fastify.addHook("preHandler", async (request, reply) => {
    validateApiKey(request, reply);
  });

  // Get all contacts
  fastify.get("/contacts", {
    schema: {
      description: "Get all contacts",
      tags: ["Contacts"],
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
                  pushname: { type: "string" },
                  shortName: { type: "string" },
                  isMe: { type: "boolean" },
                  isUser: { type: "boolean" },
                  isGroup: { type: "boolean" },
                  isBlocked: { type: "boolean" },
                  isBusiness: { type: "boolean" },
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
      const contacts = await client.getContacts();
      const data = contacts.map((c) => ({
        id: c.id._serialized,
        name: c.name || null,
        pushname: c.pushname || null,
        shortName: c.shortName || null,
        isMe: c.isMe,
        isUser: c.isUser,
        isGroup: c.isGroup,
        isBlocked: c.isBlocked,
        isBusiness: c.isBusiness,
      }));
      return reply.send({ status: "success", data });
    } catch (error) {
      logger.error({ error }, "Failed to get contacts");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to get contacts", true);
    }
  });

  // Get contact by ID
  fastify.get("/contacts/:id", {
    schema: {
      description: "Get contact by ID",
      tags: ["Contacts"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    const contactId = id.includes("@") ? id : `${id}@c.us`;
    try {
      const contact = await client.getContactById(contactId);
      return reply.send({
        status: "success",
        data: {
          id: contact.id._serialized,
          name: contact.name || null,
          pushname: contact.pushname || null,
          shortName: contact.shortName || null,
          isMe: contact.isMe,
          isUser: contact.isUser,
          isGroup: contact.isGroup,
          isBlocked: contact.isBlocked,
          isBusiness: contact.isBusiness,
        },
      });
    } catch (error) {
      logger.error({ error, contactId }, "Failed to get contact");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.NOT_FOUND, "Contact not found", true);
    }
  });

  // Get contact profile picture
  fastify.get("/contacts/:id/picture", {
    schema: {
      description: "Get contact profile picture URL",
      tags: ["Contacts"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    const contactId = id.includes("@") ? id : `${id}@c.us`;
    try {
      const url = await client.getProfilePicUrl(contactId);
      return reply.send({ status: "success", data: { url: url || null } });
    } catch (error) {
      logger.error({ error, contactId }, "Failed to get profile picture");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.NOT_FOUND, "Profile picture not found", true);
    }
  });

  // Block contact
  fastify.post("/contacts/:id/block", {
    schema: {
      description: "Block a contact",
      tags: ["Contacts"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    const contactId = id.includes("@") ? id : `${id}@c.us`;
    try {
      const contact = await client.getContactById(contactId);
      await contact.block();
      logger.info({ contactId }, "Contact blocked");
      return reply.send({ status: "success", message: "Contact blocked" });
    } catch (error) {
      logger.error({ error, contactId }, "Failed to block contact");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to block contact", true);
    }
  });

  // Unblock contact
  fastify.post("/contacts/:id/unblock", {
    schema: {
      description: "Unblock a contact",
      tags: ["Contacts"],
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  }, async (request, reply) => {
    ensureClientReady();
    const { id } = request.params;
    const contactId = id.includes("@") ? id : `${id}@c.us`;
    try {
      const contact = await client.getContactById(contactId);
      await contact.unblock();
      logger.info({ contactId }, "Contact unblocked");
      return reply.send({ status: "success", message: "Contact unblocked" });
    } catch (error) {
      logger.error({ error, contactId }, "Failed to unblock contact");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to unblock contact", true);
    }
  });

  // Get blocked contacts
  fastify.get("/contacts/blocked", {
    schema: {
      description: "Get all blocked contacts",
      tags: ["Contacts"],
    },
  }, async (request, reply) => {
    ensureClientReady();
    try {
      const blocked = await client.getBlockedContacts();
      const data = blocked.map((c) => ({
        id: c.id._serialized,
        name: c.name || null,
        pushname: c.pushname || null,
      }));
      return reply.send({ status: "success", data });
    } catch (error) {
      logger.error({ error }, "Failed to get blocked contacts");
      throw new AppError(ErrorTypes.WHATSAPP_ERROR, HttpStatusCodes.INTERNAL_SERVER_ERROR, "Failed to get blocked contacts", true);
    }
  });
}
