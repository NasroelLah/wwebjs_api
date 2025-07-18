import logger from "../logger.mjs";
import { client, lastQr, getClientState, isClientReady } from "../whatsappClient.mjs";
import { AppError, ErrorTypes, HttpStatusCodes } from "../errors/AppError.mjs";

export async function getDeviceStatus(request, reply) {
  try {
    const clientState = getClientState();
    const isReady = isClientReady();
    
    let deviceInfo = null;
    if (client.info && client.info.wid) {
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
        isConnected: client.info && client.info.wid ? true : false,
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
    const clientState = getClientState();
    
    if (isClientReady()) {
      return reply.code(200).send({
        status: "success",
        message: "Device is already connected and ready",
        data: {
          state: clientState,
          device: client.info ? {
            number: client.info.wid.user,
            name: client.info.pushname || 'Unknown'
          } : null
        }
      });
    }
    
    if (clientState === 'CONNECTING' && lastQr) {
      return reply.code(200).send({
        status: "success",
        message: "Connection in progress. Please scan the QR code",
        data: {
          state: clientState,
          qr: lastQr,
          instruction: "Scan this QR code with your WhatsApp mobile app"
        }
      });
    }
    
    // If disconnected, try to reinitialize
    if (clientState === 'DISCONNECTED') {
      logger.info("Attempting to reconnect WhatsApp client");
      
      // Wait for QR code generation with timeout
      const qrPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("QR code generation timeout"));
        }, 10000);
        
        const onQr = (qr) => {
          clearTimeout(timeout);
          client.removeListener('qr', onQr);
          resolve(qr);
        };
        
        client.once('qr', onQr);
        
        // If already have QR, resolve immediately
        if (lastQr) {
          clearTimeout(timeout);
          resolve(lastQr);
        }
      });
      
      try {
        client.initialize();
        const qrCode = await qrPromise;
        
        return reply.code(200).send({
          status: "success",
          message: "QR code generated successfully",
          data: {
            state: 'CONNECTING',
            qr: qrCode,
            instruction: "Scan this QR code with your WhatsApp mobile app",
            expiresIn: "2 minutes"
          }
        });
      } catch (error) {
        logger.error({ error: error.message }, "Failed to generate QR code");
        throw new AppError(
          ErrorTypes.WHATSAPP_ERROR,
          HttpStatusCodes.INTERNAL_SERVER_ERROR,
          "Failed to generate QR code. Please try again.",
          true
        );
      }
    }
    
    // Fallback: return current QR if available
    if (lastQr) {
      return reply.code(200).send({
        status: "success",
        message: "Using existing QR code",
        data: {
          state: clientState,
          qr: lastQr,
          instruction: "Scan this QR code with your WhatsApp mobile app"
        }
      });
    }
    
    throw new AppError(
      ErrorTypes.WHATSAPP_ERROR,
      HttpStatusCodes.SERVICE_UNAVAILABLE,
      "Unable to generate QR code. WhatsApp service may be unavailable.",
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
      await client.logout();
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
