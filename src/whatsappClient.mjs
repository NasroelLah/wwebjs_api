/* global process */
import qrcode from "qrcode-terminal";
import { createRequire } from "module";
import { request } from "undici";
import { WEBHOOK_URL } from "./config.mjs";

const require = createRequire(import.meta.url);
const { Client, LocalAuth } = require("whatsapp-web.js");

export const client = new Client({
  authStrategy: new LocalAuth(),
});

export let lastQr = null;

client.on("qr", (qr) => {
  qrcode.generate(qr, { small: true });
  lastQr = qr;
  console.log("QR code event received");
});

client.on("ready", () => {
  console.log("Client ready");
});

client.on("auth_failure", (msg) => {
  console.error("Auth Failure:", msg);
});

client.on("disconnected", (reason) => {
  console.log("Client disconnected:", reason);
});

client.on("message", async (msg) => {
  if (msg.fromMe && process.env.WEBHOOK_EXCLUDE_ME === "true") {
    console.log("Skipping webhook: message from self.");
    return;
  }
  if (
    msg.from.endsWith("@g.us") &&
    process.env.WEBHOOK_EXCLUDE_GROUP === "true"
  ) {
    console.log("Skipping webhook: group message.");
    return;
  }
  if (msg.isChannel && process.env.WEBHOOK_EXCLUDE_CHANNEL === "true") {
    console.log("Skipping webhook: channel message.");
    return;
  }

  console.log("Message received:", msg.body);
  if (msg.type === "image" || msg.type === "document") {
    console.log("Media message received of type:", msg.type);
  }
  if (!WEBHOOK_URL) {
    console.error("WEBHOOK_URL not set");
    return;
  }
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
  try {
    const response = await request(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (response.statusCode >= 200 && response.statusCode < 300) {
      console.log("Message data sent to webhook");
    } else {
      console.error(`Webhook responded with status ${response.statusCode}`);
    }
  } catch (error) {
    console.error("Failed sending webhook:", error.message);
  }
});

export function initializeWhatsApp() {
  client.initialize();
}
