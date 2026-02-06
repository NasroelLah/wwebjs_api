import qrcode from "qrcode-terminal";
import { request } from "undici";
import { WEBHOOK_URL, webhookConfig } from "./config.mjs";
import logger from "./logger.mjs";
import wwebjs from "whatsapp-web.js";

const { Client, LocalAuth } = wwebjs;

async function sendWebhook(event, data) {
  if (!WEBHOOK_URL) return;
  try {
    const payload = { event, timestamp: Date.now(), ...data };
    const response = await request(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (response.statusCode >= 200 && response.statusCode < 300) {
      logger.debug({ event }, "Webhook sent");
    } else {
      logger.error({ event, statusCode: response.statusCode }, "Webhook error");
    }
  } catch (error) {
    logger.error({ event, error: error.message }, "Webhook failed");
  }
}

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

// Message received
client.on("message", async (msg) => {
  if (msg.fromMe && webhookConfig.excludeMe) return;
  if (msg.from.endsWith("@g.us") && webhookConfig.excludeGroup) return;
  if (msg.isChannel && webhookConfig.excludeChannel) return;

  logger.info({ type: msg.type, from: msg.from }, "Message received");

  const isGroup = msg.from.endsWith("@g.us");
  const cleanedFrom = msg.from.replace(/@c\.us$|@g\.us$/, "");
  let senderNumber;
  if (isGroup) {
    const parts = msg.id._serialized.split("_");
    if (parts.length >= 1) senderNumber = parts[parts.length - 1].replace("@c.us", "");
  }

  await sendWebhook("message", {
    id: msg.id._serialized,
    from: cleanedFrom,
    to: msg.to,
    body: msg.body,
    type: msg.type,
    timestamp: msg.timestamp,
    origin: isGroup ? "group" : "individual",
    fromNumber: senderNumber || null,
    hasMedia: msg.hasMedia,
    isForwarded: msg.isForwarded,
  });
});

// Message created (includes sent messages)
client.on("message_create", async (msg) => {
  if (!msg.fromMe) return; // Only track our own sent messages
  logger.debug({ id: msg.id._serialized }, "Message created");
  await sendWebhook("message_create", {
    id: msg.id._serialized,
    to: msg.to,
    body: msg.body,
    type: msg.type,
    timestamp: msg.timestamp,
  });
});

// Message acknowledgment (sent, delivered, read)
client.on("message_ack", async (msg, ack) => {
  const ackStatus = ["ERROR", "PENDING", "SENT", "RECEIVED", "READ", "PLAYED"];
  logger.debug({ id: msg.id._serialized, ack: ackStatus[ack] || ack }, "Message ack");
  await sendWebhook("message_ack", {
    id: msg.id._serialized,
    ack,
    ackName: ackStatus[ack] || "UNKNOWN",
  });
});

// Message revoked/deleted
client.on("message_revoke_everyone", async (msg, revokedMsg) => {
  logger.info({ id: msg.id._serialized }, "Message revoked");
  await sendWebhook("message_revoke", {
    id: msg.id._serialized,
    revokedMessage: revokedMsg ? {
      id: revokedMsg.id._serialized,
      body: revokedMsg.body,
      from: revokedMsg.from,
    } : null,
  });
});

// Message reaction
client.on("message_reaction", async (reaction) => {
  logger.debug({ msgId: reaction.msgId._serialized }, "Message reaction");
  await sendWebhook("message_reaction", {
    messageId: reaction.msgId._serialized,
    reaction: reaction.reaction,
    senderId: reaction.senderId._serialized,
    timestamp: reaction.timestamp,
  });
});

// Message edited
client.on("message_edit", async (msg, newBody, prevBody) => {
  logger.debug({ id: msg.id._serialized }, "Message edited");
  await sendWebhook("message_edit", {
    id: msg.id._serialized,
    newBody,
    prevBody,
  });
});

// Group join
client.on("group_join", async (notification) => {
  logger.info({ groupId: notification.chatId }, "Group join");
  await sendWebhook("group_join", {
    chatId: notification.chatId,
    participant: notification.id.participant,
    by: notification.author || null,
    timestamp: notification.timestamp,
  });
});

// Group leave
client.on("group_leave", async (notification) => {
  logger.info({ groupId: notification.chatId }, "Group leave");
  await sendWebhook("group_leave", {
    chatId: notification.chatId,
    participant: notification.id.participant,
    timestamp: notification.timestamp,
  });
});

// Group update (subject, description, etc)
client.on("group_update", async (notification) => {
  logger.info({ groupId: notification.chatId, type: notification.type }, "Group update");
  await sendWebhook("group_update", {
    chatId: notification.chatId,
    type: notification.type,
    author: notification.author,
    timestamp: notification.timestamp,
    body: notification.body,
  });
});

// Group admin changed
client.on("group_admin_changed", async (notification) => {
  logger.info({ groupId: notification.chatId }, "Group admin changed");
  await sendWebhook("group_admin_changed", {
    chatId: notification.chatId,
    participant: notification.id.participant,
    action: notification.type, // promote or demote
    timestamp: notification.timestamp,
  });
});

// Incoming call
client.on("call", async (call) => {
  logger.info({ from: call.from, isVideo: call.isVideo }, "Incoming call");
  await sendWebhook("call", {
    id: call.id,
    from: call.from,
    isVideo: call.isVideo,
    isGroup: call.isGroup,
    timestamp: Date.now(),
  });
});

// Contact changed
client.on("contact_changed", async (message, oldId, newId, isContact) => {
  logger.info({ oldId, newId }, "Contact changed");
  await sendWebhook("contact_changed", {
    oldId,
    newId,
    isContact,
  });
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
