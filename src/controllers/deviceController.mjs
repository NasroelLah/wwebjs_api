import logger from "../logger.mjs";
import { client, lastQr } from "../whatsappClient.mjs";

export async function getDeviceStatus(request, reply) {
  try {
    if (!client.info || !client.info.wid) {
      return reply.code(200).send({
        status: "success",
        message: "No device connected.",
        data: null,
      });
    }
    return reply.code(200).send({
      status: "success",
      message: "Device information retrieved successfully.",
      data: client.info,
    });
  } catch (error) {
    logger.error(`Error retrieving device information: ${error.message}`);
    return reply.code(500).send({
      status: "error",
      message: "Unable to retrieve device information.",
    });
  }
}

export async function connectDevice(request, reply) {
  try {
    if (client.info && client.info.wid) {
      return reply.code(200).send({
        status: "success",
        message: "Device already connected.",
      });
    }
    const qrValue =
      lastQr ??
      (await new Promise((resolve, reject) => {
        client.once("qr", (qr) => resolve(qr));
        setTimeout(
          () => reject(new Error("QR code not received within timeout")),
          5000
        );
      }));
    client.initialize();
    return reply.code(200).send({
      status: "success",
      message: "Device connection initiated.",
      data: qrValue,
    });
  } catch (error) {
    logger.error(`Error connecting device: ${error.message}`);
    return reply.code(500).send({
      status: "error",
      message: "Unable to generate QR code.",
    });
  }
}

export async function removeDevice(request, reply) {
  try {
    if (client.info && client.info.wid) {
      try {
        await client.logout();
        return reply.code(200).send({
          status: "success",
          message: "Device removed successfully.",
        });
      } catch (err) {
        if (err.message && err.message.includes("Session closed")) {
          return reply.code(200).send({
            status: "success",
            message: "Device already removed.",
          });
        }
        throw err;
      }
    } else {
      return reply.code(400).send({
        status: "error",
        message: "No device connected.",
      });
    }
  } catch (error) {
    logger.error(`Error removing device: ${error.message}`);
    return reply.code(500).send({
      status: "error",
      message: "Unable to remove device.",
    });
  }
}
