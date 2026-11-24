import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

process.env.NODE_ENV = "test";
process.env.API_KEY = "lifecycle-test-key";
const { client, initializeWhatsApp, waitForWhatsAppConnection, stopWhatsApp, getClientState, isClientReady } = await import("../whatsappClient.mjs");
const { deviceRoute } = await import("../routes/device.mjs");

const request = (url) => ({ method: "POST", url, headers: { authorization: "Bearer lifecycle-test-key" } });

test("concurrent connections share initialization and authenticated is not ready", async (t) => {
  let finish;
  const init = t.mock.method(client, "initialize", () => new Promise((resolve) => { finish = resolve; }));
  t.mock.method(client, "destroy", async () => {});
  const first = initializeWhatsApp();
  const second = initializeWhatsApp();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(init.mock.calls.length, 1);
  client.info = { wid: { user: "123" } };
  client.emit("authenticated");
  assert.equal(getClientState(), "CONNECTED");
  assert.equal(isClientReady(), false);
  const waiting = waitForWhatsAppConnection(1000);
  client.emit("ready");
  assert.deepEqual(await waiting, { state: "READY", qr: null });
  finish();
  await first;
  assert.equal(isClientReady(), true);
  client.emit("disconnected", "test");
  assert.equal(getClientState(), "DISCONNECTED");
  assert.equal(isClientReady(), false);
});

test("initialization failure is reported and permits another connection", async (t) => {
  let finish;
  const init = t.mock.method(client, "initialize", () => new Promise((resolve, reject) => { finish = reject; }));
  const destroy = t.mock.method(client, "destroy", async () => {});
  const waiting = waitForWhatsAppConnection(1000);
  await Promise.resolve();
  finish(new Error("browser missing"));
  await assert.rejects(waiting, /browser missing/);
  assert.equal(getClientState(), "DISCONNECTED");
  assert.equal(destroy.mock.calls.length, 1);
  init.mock.mockImplementation(async () => { client.emit("ready"); });
  assert.deepEqual(await waitForWhatsAppConnection(1000), { state: "READY", qr: null });
  await stopWhatsApp();
});

test("device connect handles restored sessions and restart does not require a QR", async (t) => {
  const app = Fastify();
  await app.register(deviceRoute);
  t.after(() => app.close());
  const destroy = t.mock.method(client, "destroy", async () => {});
  const init = t.mock.method(client, "initialize", async () => { client.emit("ready"); });
  let response = await app.inject(request("/device/connect"));
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.state, "READY");
  assert.equal(init.mock.calls.length, 1);
  response = await app.inject(request("/device/restart"));
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.state, "READY");
  assert.equal(init.mock.calls.length, 2);
  assert.equal(destroy.mock.calls.length, 1);
  await stopWhatsApp();
});

test("auth failure removes pending listeners and leaves disconnected state", async (t) => {
  t.mock.method(client, "destroy", async () => {});
  t.mock.method(client, "initialize", async () => { client.emit("auth_failure", "invalid session"); });
  const before = client.listenerCount("ready");
  await assert.rejects(waitForWhatsAppConnection(1000), /invalid session/);
  assert.equal(client.listenerCount("ready"), before);
  assert.equal(getClientState(), "DISCONNECTED");
  await stopWhatsApp();
});

test("QR connection reuses the latest code and clears it after authentication", async (t) => {
  const init = t.mock.method(client, "initialize", async () => { client.emit("qr", "test-qr"); });
  t.mock.method(client, "destroy", async () => {});
  const first = await waitForWhatsAppConnection(1000);
  const second = await waitForWhatsAppConnection(1000);
  assert.deepEqual(first, { state: "CONNECTING", qr: "test-qr" });
  assert.deepEqual(second, first);
  assert.equal(init.mock.calls.length, 1);
  client.emit("authenticated");
  const waiting = waitForWhatsAppConnection(1000);
  client.emit("ready");
  assert.deepEqual(await waiting, { state: "READY", qr: null });
  await stopWhatsApp();
});

test("client stops accepting sends while its browser is closing", async (t) => {
  let finish;
  t.mock.method(client, "destroy", () => new Promise((resolve) => { finish = resolve; }));
  client.emit("ready");
  const stopping = stopWhatsApp();
  assert.equal(isClientReady(), false);
  assert.equal(getClientState(), "DISCONNECTING");
  client.emit("ready");
  assert.equal(isClientReady(), false);
  finish();
  await stopping;
  assert.equal(getClientState(), "DISCONNECTED");
});
