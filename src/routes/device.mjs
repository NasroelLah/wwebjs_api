import { validateApiKey } from "../middleware/auth.mjs";
import { client, getClientState, isClientReady, waitForWhatsAppConnection, stopWhatsApp } from "../whatsappClient.mjs";
import logger from "../logger.mjs";
import { AppError, ErrorTypes, HttpStatusCodes } from "../errors/AppError.mjs";

export async function deviceRoute(fastify) {
  // Apply auth to all routes
  fastify.addHook("preHandler", async (request, reply) => {
    validateApiKey(request, reply);
  });

  // Get device status
  fastify.get("/device/status", {
    schema: {
      description: "Get WhatsApp device connection status",
      tags: ["Device"],
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "string" },
            data: {
              type: "object",
              properties: {
                state: { type: "string" },
                isReady: { type: "boolean" },
                isConnected: { type: "boolean" },
                device: {
                  type: "object",
                  properties: {
                    number: { type: "string" },
                    name: { type: "string" },
                    platform: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const clientState = getClientState();
      const isReady = isClientReady();

      let deviceInfo = null;
      if (isReady && client.info?.wid) {
        deviceInfo = {
          number: client.info.wid.user,
          name: client.info.pushname || "Unknown",
          platform: client.info.platform || "Unknown",
        };
      }

      return reply.send({
        status: "success",
        data: {
          state: clientState,
          isReady,
          isConnected: clientState === "CONNECTED" || isReady,
          device: deviceInfo,
        },
      });
    } catch (error) {
      logger.error({ error: error.message }, "Error getting device status");
      throw new AppError(
        ErrorTypes.WHATSAPP_ERROR,
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        "Failed to get device status",
        true
      );
    }
  });

  // Connect device - returns QR code
  fastify.post("/device/connect", {
    schema: {
      description: "Connect WhatsApp device (generates QR code)",
      tags: ["Device"],
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "string" },
            message: { type: "string" },
            data: {
              type: "object",
              properties: {
                state: { type: "string" },
                qr: { type: "string" },
                instruction: { type: "string" },
                expiresIn: { type: "string" },
                device: {
                  type: "object",
                  properties: {
                    number: { type: "string" },
                    name: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const connection = await waitForWhatsAppConnection();
      if (connection.state === "READY") {
        return reply.send({
          status: "success",
          message: "Device is already connected",
          data: {
            state: "READY",
            qr: null,
            device: client.info?.wid ? {
              number: client.info.wid.user,
              name: client.info.pushname || "Unknown",
            } : null,
          },
        });
      }
      return reply.send({
        status: "success",
        message: "Scan QR code to connect",
        data: {
          state: connection.state,
          qr: connection.qr,
          instruction: "Scan this QR code with WhatsApp on your phone",
          expiresIn: "2 minutes",
        },
      });
    } catch (error) {
      if (error instanceof AppError) throw error;

      logger.error({ error: error.message }, "Error connecting device");
      throw new AppError(
        ErrorTypes.WHATSAPP_ERROR,
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        "Failed to connect device",
        true
      );
    }
  });

  // Disconnect device
  fastify.post("/device/disconnect", {
    schema: {
      description: "Disconnect WhatsApp device (logout)",
      tags: ["Device"],
      response: {
        200: {
          type: "object",
          properties: {
            status: { type: "string" },
            message: { type: "string" },
          },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const clientState = getClientState();

      // Already disconnected
      if (!isClientReady() && clientState === "DISCONNECTED") {
        return reply.send({
          status: "success",
          message: "Device is not connected",
        });
      }

      try {
        await stopWhatsApp(true);
        logger.info("Device disconnected successfully");

        return reply.send({
          status: "success",
          message: "Device disconnected successfully",
        });
      } catch (logoutError) {
        // Handle already closed session
        if (logoutError.message?.includes("Session closed")) {
          return reply.send({
            status: "success",
            message: "Device was already disconnected",
          });
        }
        throw logoutError;
      }
    } catch (error) {
      if (error instanceof AppError) throw error;

      logger.error({ error: error.message }, "Error disconnecting device");
      throw new AppError(
        ErrorTypes.WHATSAPP_ERROR,
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        "Failed to disconnect device",
        true
      );
    }
  });

  // Restart device (disconnect + connect)
  fastify.post("/device/restart", {
    schema: {
      description: "Restart WhatsApp device connection",
      tags: ["Device"],
    },
  }, async (request, reply) => {
    try {
      await stopWhatsApp();
      const connection = await waitForWhatsAppConnection();
      return reply.send({
        status: "success",
        message: connection.state === "READY" ? "Device restarted and ready" : "Device restarted. Scan QR code to reconnect",
        data: connection.state === "READY" ? { state: "READY", qr: null } : {
          state: connection.state,
          qr: connection.qr,
          instruction: "Scan this QR code with WhatsApp on your phone",
          expiresIn: "2 minutes",
        },
      });
    } catch (error) {
      logger.error({ error: error.message }, "Error restarting device");
      throw new AppError(
        ErrorTypes.WHATSAPP_ERROR,
        HttpStatusCodes.INTERNAL_SERVER_ERROR,
        "Failed to restart device",
        true
      );
    }
  });
}
