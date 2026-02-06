import { validateApiKey } from "../middleware/auth.mjs";
import { client, lastQr, getClientState, isClientReady } from "../whatsappClient.mjs";
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
      if (client.info && client.info.wid) {
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
          isConnected: !!(client.info && client.info.wid),
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
      const clientState = getClientState();

      // Already connected
      if (isClientReady()) {
        return reply.send({
          status: "success",
          message: "Device is already connected",
          data: {
            state: clientState,
            qr: null,
            device: client.info
              ? {
                  number: client.info.wid.user,
                  name: client.info.pushname || "Unknown",
                }
              : null,
          },
        });
      }

      // Connection in progress, return existing QR
      if (clientState === "CONNECTING" && lastQr) {
        return reply.send({
          status: "success",
          message: "Scan QR code to connect",
          data: {
            state: clientState,
            qr: lastQr,
            instruction: "Scan this QR code with WhatsApp on your phone",
            expiresIn: "2 minutes",
          },
        });
      }

      // Disconnected - initialize and wait for QR
      if (clientState === "DISCONNECTED") {
        logger.info("Initializing WhatsApp client for connection");

        const qrPromise = new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            client.removeListener("qr", onQr);
            reject(new Error("QR code generation timeout"));
          }, 15000);

          const onQr = (qr) => {
            clearTimeout(timeout);
            client.removeListener("qr", onQr);
            resolve(qr);
          };

          client.once("qr", onQr);

          // If QR already exists, use it
          if (lastQr) {
            clearTimeout(timeout);
            client.removeListener("qr", onQr);
            resolve(lastQr);
          }
        });

        client.initialize();
        const qrCode = await qrPromise;

        return reply.send({
          status: "success",
          message: "Scan QR code to connect",
          data: {
            state: "CONNECTING",
            qr: qrCode,
            instruction: "Scan this QR code with WhatsApp on your phone",
            expiresIn: "2 minutes",
          },
        });
      }

      // Fallback - return existing QR if available
      if (lastQr) {
        return reply.send({
          status: "success",
          message: "Scan QR code to connect",
          data: {
            state: clientState,
            qr: lastQr,
            instruction: "Scan this QR code with WhatsApp on your phone",
            expiresIn: "2 minutes",
          },
        });
      }

      throw new AppError(
        ErrorTypes.WHATSAPP_ERROR,
        HttpStatusCodes.SERVICE_UNAVAILABLE,
        "Unable to generate QR code",
        true
      );
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
        await client.logout();
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
      // Try to destroy existing connection
      try {
        await client.destroy();
        logger.info("Client destroyed for restart");
      } catch {
        // Ignore destroy errors
      }

      // Wait a bit then reinitialize
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const qrPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          client.removeListener("qr", onQr);
          reject(new Error("QR code generation timeout"));
        }, 15000);

        const onQr = (qr) => {
          clearTimeout(timeout);
          client.removeListener("qr", onQr);
          resolve(qr);
        };

        client.once("qr", onQr);
      });

      client.initialize();
      const qrCode = await qrPromise;

      return reply.send({
        status: "success",
        message: "Device restarted. Scan QR code to reconnect",
        data: {
          state: "CONNECTING",
          qr: qrCode,
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
