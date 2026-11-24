import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import wwebjs from "whatsapp-web.js";

process.env.NODE_ENV = "test";
process.env.SQLITE_PATH = ":memory:";
process.env.API_KEY = "schedule-test-key";
process.env.QUEUE_CONNECTION = "cron";
process.env.APP_TIMEZONE = "UTC";
process.env.MESSAGE_DELAY = "0";
const { client } = await import("../whatsappClient.mjs");
const { dbManager, saveScheduledMessage, getScheduledMessages, updateMessageStatus } = await import("./dbHelper.mjs");
const { scheduleDispatch } = await import("./scheduleHelper.mjs");
const { processScheduledMessages } = await import("../jobs/processScheduledMessages.mjs");
const { messageRoute } = await import("../routes/message.mjs");
const { Location, MessageMedia } = wwebjs;

test("scheduled messages wait for readiness and preserve text, media and location", async (t) => {
  const sent = [];
  t.mock.method(client, "sendMessage", async (chatId, content, options) => {
    sent.push({ chatId, content, options });
    return { id: "sent" };
  });
  await saveScheduledMessage("111@c.us", '{"hello":true}', { caption: "text" }, 0);
  await saveScheduledMessage("222@c.us", new MessageMedia("image/png", "YWJj", "a.png", 3), {}, 0);
  await saveScheduledMessage("333@c.us", new Location(-6.2, 106.8, { address: "Jakarta" }), {}, 0);

  await processScheduledMessages();
  assert.equal(sent.length, 0);
  assert.equal((await getScheduledMessages()).length, 3);
  client.emit("ready");
  await Promise.all([processScheduledMessages(), processScheduledMessages()]);
  assert.equal(sent.length, 3);
  const sentByChat = new Map(sent.map((item) => [item.chatId, item]));
  assert.equal(sentByChat.get("111@c.us").content, '{"hello":true}');
  assert.ok(sentByChat.get("222@c.us").content instanceof MessageMedia);
  assert.equal(sentByChat.get("222@c.us").content.filename, "a.png");
  assert.equal(sentByChat.get("222@c.us").content.filesize, 3);
  assert.ok(sentByChat.get("333@c.us").content instanceof Location);
  assert.equal(sentByChat.get("333@c.us").content.address, "Jakarta");
  assert.equal((await getScheduledMessages()).length, 0);
});

test("failed storage does not report successful scheduling", async (t) => {
  t.mock.method(dbManager, "connect", async () => { throw new Error("disk unavailable"); });
  const future = new Date(Date.now() + 3600000).toISOString().replace("T", " ").slice(0, 19);
  await assert.rejects(scheduleDispatch("111@c.us", "hello", {}, future), /Failed to save scheduled message/);
});

test("uncertain send is not selected for another automatic attempt", async (t) => {
  const setTimeoutOriginal = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (callback, delay, ...args) =>
    setTimeoutOriginal(callback, delay === 30000 ? 0 : delay, ...args)
  );
  const send = t.mock.method(client, "sendMessage", () => new Promise(() => {}));
  const id = await saveScheduledMessage("444@c.us", "hello", {}, 0);
  await processScheduledMessages();
  await processScheduledMessages();
  assert.equal(send.mock.calls.length, 1);
  assert.equal((await getScheduledMessages()).some((message) => message._id === id), false);
  const row = dbManager.getDatabase().prepare("SELECT status FROM scheduled_messages WHERE id = ?").get(id);
  assert.equal(row.status, "unknown");
  await updateMessageStatus(id, "cancelled");
});


test("message endpoint schedules and later sends an upstream Location", async (t) => {
  const app = Fastify();
  await app.register(messageRoute);
  t.after(() => app.close());
  const send = t.mock.method(client, "sendMessage", async () => ({ id: "location" }));
  const schedule = new Date(Date.now() + 3600000).toISOString().replace("T", " ").slice(0, 19);
  const response = await app.inject({
    method: "POST",
    url: "/message",
    headers: { authorization: "Bearer schedule-test-key" },
    payload: {
      recipient_type: "individual", to: "628123456789", type: "location",
      location: { latitude: -6.2, longitude: 106.8, address: "Jakarta" }, schedule,
    },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().message, "Message scheduled successfully");
  const row = dbManager.getDatabase().prepare("SELECT id FROM scheduled_messages WHERE status = 'scheduled'").get();
  assert.ok(row);
  dbManager.getDatabase().prepare("UPDATE scheduled_messages SET scheduled_time = ? WHERE id = ?").run(new Date(0).toISOString(), row.id);
  await processScheduledMessages();
  assert.equal(send.mock.calls.length, 1);
  assert.ok(send.mock.calls[0].arguments[1] instanceof Location);
  assert.equal(send.mock.calls[0].arguments[1].address, "Jakarta");
});

test("legacy scheduled media and locations are restored from SQLite", async (t) => {
  const send = t.mock.method(client, "sendMessage", async () => ({ id: "sent" }));
  const db = dbManager.getDatabase();
  const insert = db.prepare(`INSERT INTO scheduled_messages
    (id, chat_id, content, options, scheduled_time, status, created_at, updated_at)
    VALUES (?, ?, ?, NULL, ?, 'scheduled', ?, ?)`);
  const timestamp = new Date(0).toISOString();
  insert.run("legacy-media", "111@c.us", JSON.stringify({ mimetype: "image/png", data: "YWJj", filename: "old.png" }), timestamp, timestamp, timestamp);
  insert.run("legacy-location", "222@c.us", JSON.stringify({ location: { latitude: -6.2, longitude: 106.8, description: "Jakarta" } }), timestamp, timestamp, timestamp);
  await processScheduledMessages();
  assert.equal(send.mock.calls.length, 2);
  const contents = send.mock.calls.map((call) => call.arguments[1]);
  assert.ok(contents.some((content) => content instanceof MessageMedia));
  assert.ok(contents.some((content) => content instanceof Location && content.address === "Jakarta"));
});