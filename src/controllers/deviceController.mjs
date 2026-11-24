import logger from "../logger.mjs";
import { client, lastQr, getClientState, isClientReady, waitForWhatsAppConnection, stopWhatsApp } from "../whatsappClient.mjs";
import { AppError, ErrorTypes, HttpStatusCodes } from "../errors/AppError.mjs";

export async function getDeviceStatus(request, reply) {
  try {
    const clientState = getClientState();
    const isReady = isClientReady();
    
    let deviceInfo = null;
    if (isReady && client.info?.wid) {
      deviceInfo = {
        number: client.info.wid.user,
        name: client.info.pushname || 'Unknown',
        platform: client.info.platform || 'Unknown'
      };
    }
    
    return reply.code(200).send({
      status: "success",
      message: "Device status retrieved successfully",
      data: {
        state: clientState,
        isReady,
        isConnected: clientState === 'CONNECTED' || isReady,
        device: deviceInfo,
        lastQrGenerated: lastQr ? new Date().toISOString() : null
      }
    });
  } catch (error) {
    logger.error({ error: error.message }, "Error retrieving device information");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Unable to retrieve device information",
      true
    );
  }
}

export async function connectDevice(request, reply) {
  try {
    const connection = await waitForWhatsAppConnection();
    return reply.code(200).send({
      status: "success",
      message: connection.state === "READY" ? "Device is already connected and ready" : "Connection in progress. Please scan the QR code",
      data: connection.state === "READY" ? {
        state: "READY",
        device: client.info?.wid ? { number: client.info.wid.user, name: client.info.pushname || "Unknown" } : null,
      } : {
        state: connection.state,
        qr: connection.qr,
        instruction: "Scan this QR code with your WhatsApp mobile app",
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
}

export async function removeDevice(request, reply) {
  try {
    const clientState = getClientState();
    
    if (!isClientReady() && clientState === 'DISCONNECTED') {
      return reply.code(200).send({
        status: "success",
        message: "No device connected"
      });
    }
    
    try {
      await stopWhatsApp(true);
      logger.info("Device disconnected successfully");
      
      return reply.code(200).send({
        status: "success",
        message: "Device removed successfully"
      });
    } catch (logoutError) {
      // Handle case where session is already closed
      if (logoutError.message && logoutError.message.includes("Session closed")) {
        return reply.code(200).send({
          status: "success",
          message: "Device was already removed"
        });
      }
      throw logoutError;
    }
  } catch (error) {
    logger.error({ error: error.message }, "Error removing device");
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.INTERNAL_SERVER_ERROR,
      "Unable to remove device",
      true
    );
  }
}
