import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

// The WhatsApp client is not initialized; lookups and message methods are replaced per test.
process.env.NODE_ENV = "test";
process.env.API_KEY = "test-api-key";
const { client } = await import("../whatsappClient.mjs");
const { messageActionsRoute } = await import("./messageActions.mjs");
const messageController = await import("../controllers/messageController.mjs");
const { AppError } = await import("../errors/AppError.mjs");
client.emit("ready");

const AUTH = { authorization: "Bearer test-api-key" };

async function buildApp() {
  const app = Fastify();
  await app.register(messageActionsRoute);
  return app;
}

function fakeMessage(overrides) {
  return {
    id: { _serialized: "msg-1" },
    forward: async () => undefined,
    pin: async () => true,
    unpin: async () => true,
    ...overrides,
  };
}

test("forward succeeds without an id when upstream resolves undefined", async (t) => {
  const forward = t.mock.fn(async () => undefined);
  t.mock.method(client, "getMessageById", async () => fakeMessage({ forward }));
  const app = await buildApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: "POST",
    url: "/messages/msg-1/forward",
    headers: AUTH,
    payload: { chatId: "123" },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json().status, "success");
  assert.equal(res.json().data, undefined);
  assert.deepEqual(forward.mock.calls[0].arguments, ["123@c.us"]);
});

test("forward reports failure when upstream rejects", async (t) => {
  t.mock.method(client, "getMessageById", async () =>
    fakeMessage({ forward: async () => { throw new Error("boom"); } })
  );
  const app = await buildApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: "POST",
    url: "/messages/msg-1/forward",
    headers: AUTH,
    payload: { chatId: "123@c.us" },
  });

  assert.equal(res.statusCode, 500);
  assert.equal(res.json().message, "Failed to forward message");
});

test("pin reports failure when upstream returns false", async (t) => {
  t.mock.method(client, "getMessageById", async () => fakeMessage({ pin: async () => false }));
  const app = await buildApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: "POST",
    url: "/messages/msg-1/pin",
    headers: AUTH,
    payload: {},
  });

  assert.equal(res.statusCode, 500);
  assert.equal(res.json().message, "Failed to pin message");
});

test("unpin reports failure when upstream returns false", async (t) => {
  t.mock.method(client, "getMessageById", async () => fakeMessage({ unpin: async () => false }));
  const app = await buildApp();
  t.after(() => app.close());

  const res = await app.inject({
    method: "POST",
    url: "/messages/msg-1/unpin",
    headers: AUTH,
  });

  assert.equal(res.statusCode, 500);
  assert.equal(res.json().message, "Failed to unpin message");
});

test("pin and unpin report success when upstream returns true", async (t) => {
  t.mock.method(client, "getMessageById", async () => fakeMessage());
  const app = await buildApp();
  t.after(() => app.close());

  const pinRes = await app.inject({ method: "POST", url: "/messages/msg-1/pin", headers: AUTH, payload: {} });
  const unpinRes = await app.inject({ method: "POST", url: "/messages/msg-1/unpin", headers: AUTH });

  assert.equal(pinRes.statusCode, 200);
  assert.equal(pinRes.json().message, "Message pinned");
  assert.equal(unpinRes.statusCode, 200);
  assert.equal(unpinRes.json().message, "Message unpinned");
});

test("controller forward resolves without an id and controller pin rejects on false", async (t) => {
  t.mock.method(client, "getMessageById", async () =>
    fakeMessage({ pin: async () => false, forward: async () => undefined })
  );

  assert.equal(await messageController.forwardMessage("msg-1", "123"), undefined);
  await assert.rejects(messageController.pinMessage("msg-1"), (error) => {
    assert.ok(error instanceof AppError);
    assert.equal(error.message, "Failed to pin message");
    return true;
  });
});
