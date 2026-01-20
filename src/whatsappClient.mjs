/* global process */
import qrcode from "qrcode-terminal";
import { request } from "undici";
import { WEBHOOK_URL } from "./config.mjs";
import logger from "./logger.mjs";
import wwebjs from "whatsapp-web.js";

const { Client, LocalAuth } = wwebjs;

export const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu'
    ]
  }
});

export let lastQr = null;
export let clientState = 'DISCONNECTED'; // DISCONNECTED, CONNECTING, CONNECTED, READY

client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
  lastQr = qr;
  clientState = 'CONNECTING';
  logger.info("QR code generated - scan to connect");
});

client.on("ready", () => {
  clientState = 'READY';
  logger.info("WhatsApp client is ready");
});

client.on("authenticated", () => {
  clientState = 'CONNECTED';
  logger.info("WhatsApp client authenticated");
});

client.on("auth_failure", (msg) => {
  clientState = 'DISCONNECTED';
  logger.error({ message: msg }, "WhatsApp authentication failed");
});

client.on("disconnected", (reason) => {
  clientState = 'DISCONNECTED';
  logger.warn({ reason }, "WhatsApp client disconnected");
});

// Add loading event handler
client.on("loading_screen", (percent, message) => {
  logger.info({ percent, message }, "WhatsApp loading");
});

// Add change_state event handler
client.on("change_state", (state) => {
  logger.info({ state }, "WhatsApp state changed");
});

client.on("message", async (msg) => {
  if (msg.fromMe && process.env.WEBHOOK_EXCLUDE_ME === "true") {
    logger.debug("Skipping webhook: message from self");
    return;
  }
  if (
    msg.from.endsWith("@g.us") &&
    process.env.WEBHOOK_EXCLUDE_GROUP === "true"
  ) {
    logger.debug("Skipping webhook: group message");
    return;
  }
  if (msg.isChannel && process.env.WEBHOOK_EXCLUDE_CHANNEL === "true") {
    logger.debug("Skipping webhook: channel message");
    return;
  }

  logger.info({ type: msg.type, from: msg.from }, "Message received");
  
  if (!WEBHOOK_URL) {
    logger.warn("WEBHOOK_URL not configured");
    return;
  }
  
  try {
    const isGroup = msg.from.endsWith("@g.us");
    let cleanedFrom = msg.from;
    if (msg.from.endsWith("@c.us")) {
      cleanedFrom = msg.from.replace("@c.us", "");
    } else if (msg.from.endsWith("@g.us")) {
      cleanedFrom = msg.from.replace("@g.us", "");
    }
    
    const origin = isGroup ? "group" : "individual";
    let senderNumber;
    if (isGroup) {
      const parts = msg.id._serialized.split("_");
      if (parts.length >= 1) {
        senderNumber = parts[parts.length - 1].replace("@c.us", "");
      }
    }
    
    const payload = {
      from: cleanedFrom,
      body: msg.body,
      timestamp: msg.timestamp,
      id: msg.id._serialized,
      origin,
    };
    
    if (isGroup && senderNumber) {
      payload.fromNumber = senderNumber;
    }
    
    const response = await request(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    
    if (response.statusCode >= 200 && response.statusCode < 300) {
      logger.debug("Message data sent to webhook");
    } else {
      logger.error({ statusCode: response.statusCode }, "Webhook responded with error");
    }
  } catch (error) {
    logger.error({ error: error.message }, "Failed sending webhook");
  }
});

export function initializeWhatsApp() {
  logger.info("Initializing WhatsApp client");
  client.initialize();
}

export function getClientState() {
  return clientState;
}

export function isClientReady() {
  return clientState === 'READY';
}
