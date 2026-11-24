/* global process */
import qrcode from "qrcode-terminal";
import { createRequire } from "module";
import { request } from "undici";
import {
  CHROMIUM_EXECUTABLE_PATH,
  WEBHOOK_TIMEOUT_MS,
  WEBHOOK_URL,
  webhookConfig
} from "./config.mjs";
import logger from "./logger.mjs";

const require = createRequire(import.meta.url);
const { Client, LocalAuth } = require("whatsapp-web.js");

let client = createWhatsAppClient();
export { client };

export let lastQr = null;
export let lastQrGeneratedAt = null;
export let clientState = "DISCONNECTED"; // DISCONNECTED, CONNECTING, CONNECTED, READY
let initializingPromise = null;

function createWhatsAppClient() {
  const instance = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      executablePath: CHROMIUM_EXECUTABLE_PATH,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu"
      ]
    },
    webVersionCache: {
      type: "remote",
      remotePath: "https://raw.githubusercontent.com/AlexxIT/WebVersion/main/webVersion.json"
    }
  });

  bindClientEvents(instance);
  return instance;
}

function bindClientEvents(instance) {
  instance.on("qr", (qr) => {
    qrcode.generate(qr, { small: true });
    lastQr = qr;
    lastQrGeneratedAt = new Date().toISOString();
    clientState = "CONNECTING";
    logger.info("QR code generated - scan to connect");
  });

  instance.on("ready", () => {
    clientState = "READY";
    initializingPromise = null;
    logger.info("WhatsApp client is ready");
  });

  instance.on("authenticated", () => {
    clientState = "CONNECTED";
    logger.info("WhatsApp client authenticated");
  });

  instance.on("auth_failure", (msg) => {
    clientState = "DISCONNECTED";
    initializingPromise = null;
    logger.error({ message: msg }, "WhatsApp authentication failed");
  });

  instance.on("disconnected", (reason) => {
    clientState = "DISCONNECTED";
    initializingPromise = null;
    logger.warn({ reason }, "WhatsApp client disconnected");
  });

  instance.on("loading_screen", (percent, message) => {
    logger.info({ percent, message }, "WhatsApp loading");
  });

  instance.on("change_state", (state) => {
    logger.info({ state }, "WhatsApp state changed");
  });

  instance.on("message", handleIncomingMessage);
}

async function handleIncomingMessage(msg) {
  if (msg.fromMe && webhookConfig.excludeMe) {
    logger.debug("Skipping webhook: message from self");
    return;
  }
  if (msg.from.endsWith("@g.us") && webhookConfig.excludeGroup) {
    logger.debug("Skipping webhook: group message");
    return;
  }
  if (msg.isChannel && webhookConfig.excludeChannel) {
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
      headersTimeout: WEBHOOK_TIMEOUT_MS,
      bodyTimeout: WEBHOOK_TIMEOUT_MS
    });

    await response.body.dump();

    if (response.statusCode >= 200 && response.statusCode < 300) {
      logger.debug("Message data sent to webhook");
    } else {
      logger.error({ statusCode: response.statusCode }, "Webhook responded with error");
    }
  } catch (error) {
    logger.error({ error: error.message }, "Failed sending webhook");
  }
}

export async function initializeWhatsApp() {
  if (isClientReady()) return client;
  if (initializingPromise) return initializingPromise;

  clientState = "CONNECTING";
  logger.info("Initializing WhatsApp client");

  initializingPromise = client.initialize()
    .then(() => client)
    .catch((error) => {
      clientState = "DISCONNECTED";
      initializingPromise = null;
      logger.error({ error: error.message }, "Failed to initialize WhatsApp client");
      throw error;
    });

  return initializingPromise;
}

export async function restartWhatsApp({ initialize = true } = {}) {
  logger.info("Restarting WhatsApp client");

  try {
    await client.destroy();
  } catch (error) {
    logger.warn({ error: error.message }, "Ignoring error while destroying WhatsApp client");
  }

  client = createWhatsAppClient();
  clientState = "DISCONNECTED";
  initializingPromise = null;

  if (!initialize) {
    return client;
  }

  return initializeWhatsApp();
}

export async function destroyWhatsApp() {
  initializingPromise = null;
  clientState = "DISCONNECTED";
  try {
    await client.destroy();
  } catch (error) {
    logger.warn({ error: error.message }, "Ignoring error while shutting down WhatsApp client");
  }
}

export function getClientState() {
  return clientState;
}

export function isClientReady() {
  return clientState === "READY";
}
