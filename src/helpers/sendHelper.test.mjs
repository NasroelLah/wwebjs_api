import { test } from "node:test";
import assert from "node:assert/strict";

// The WhatsApp client is not initialized; its send method is replaced per test.
process.env.NODE_ENV = "test";
const { client } = await import("../whatsappClient.mjs");
const { sendMessageWithRetry } = await import("./sendHelper.mjs");
client.emit("ready");

test("clears the send timeout after success and a synchronous LID failure", async (t) => {
  const pending = new Set();
  const setTimeoutOriginal = globalThis.setTimeout;
  const clearTimeoutOriginal = globalThis.clearTimeout;
  t.mock.method(globalThis, "setTimeout", (callback, delay, ...args) => {
    const timer = setTimeoutOriginal(callback, delay, ...args);
    if (delay === 30000) pending.add(timer);
    return timer;
  });
  t.mock.method(globalThis, "clearTimeout", (timer) => {
    pending.delete(timer);
    clearTimeoutOriginal(timer);
  });
  t.after(() => {
    for (const timer of pending) clearTimeoutOriginal(timer);
  });

  const expected = { id: "message-id" };
  const send = t.mock.method(client, "sendMessage", () => expected);
  assert.equal(await sendMessageWithRetry("123@c.us", "hello"), expected);
  assert.equal(pending.size, 0);

  send.mock.mockImplementation(() => {
    throw new Error("No LID for user");
  });
  await assert.rejects(sendMessageWithRetry("123@c.us", "hello"), {
    name: "VALIDATION_ERROR",
    statusCode: 400,
  });
  assert.equal(pending.size, 0);
});

test("reports an uncertain timeout without retrying the send", async (t) => {
  const setTimeoutOriginal = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (callback, delay, ...args) =>
    setTimeoutOriginal(callback, delay >= 1000 ? 0 : delay, ...args)
  );
  const send = t.mock.method(client, "sendMessage", () => new Promise(() => {}));

  await assert.rejects(sendMessageWithRetry("123@c.us", "hello"), {
    name: "NETWORK_ERROR",
    statusCode: 408,
    message: "Message send timed out; delivery status is unknown. Check the chat before retrying.",
  });
  assert.equal(send.mock.calls.length, 1);
});

test("does not claim success or retry when WhatsApp returns no message", async (t) => {
  const send = t.mock.method(client, "sendMessage", async () => undefined);
  await assert.rejects(sendMessageWithRetry("123@c.us", "hello"), {
    name: "NETWORK_ERROR",
    statusCode: 408,
    message: "WhatsApp did not return a sent message; delivery status is unknown.",
  });
  assert.equal(send.mock.calls.length, 1);
});
