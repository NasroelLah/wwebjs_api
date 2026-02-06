/**
 * @fileoverview Contact Routes - API endpoints for contact operations
 * @module routes/contact
 */

import { validateApiKey } from "../middleware/auth.mjs";
import * as contactController from "../controllers/contactController.mjs";

/**
 * Contact route plugin
 * @param {import('fastify').FastifyInstance} fastify - Fastify instance
 */
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
            data: { type: "array" },
          },
        },
      },
    },
  }, async (request, reply) => {
    const data = await contactController.getAllContacts();
    return reply.send({ status: "success", data });
  });

  // Get blocked contacts (must be before :id route)
  fastify.get("/contacts/blocked", {
    schema: {
      description: "Get all blocked contacts",
      tags: ["Contacts"],
    },
  }, async (request, reply) => {
    const data = await contactController.getBlockedContacts();
    return reply.send({ status: "success", data });
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
    const data = await contactController.getContactById(request.params.id);
    return reply.send({ status: "success", data });
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
    const url = await contactController.getProfilePicture(request.params.id);
    return reply.send({ status: "success", data: { url } });
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
    await contactController.blockContact(request.params.id);
    return reply.send({ status: "success", message: "Contact blocked" });
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
    await contactController.unblockContact(request.params.id);
    return reply.send({ status: "success", message: "Contact unblocked" });
  });
}
