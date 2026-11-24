import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import wwebjs from "whatsapp-web.js";

process.env.NODE_ENV = "test";
process.env.APP_TIMEZONE = "UTC";
process.env.API_KEY = "workflow-test-key";
process.env.QSTASH_TOKEN = "test-token";
process.env.QSTASH_CURRENT_SIGNING_KEY = "test-current";
process.env.QSTASH_NEXT_SIGNING_KEY = "test-next";
process.env.WORKFLOW_BASE_URL = "https://api.example.test";
process.env.UPSTASH_REDIS_REST_URL = "https://redis.example.test";
process.env.UPSTASH_REDIS_REST_TOKEN = "test-token";
const { redisManager } = await import("./redisHelper.mjs");
const { workflowManager } = await import("./workflowHelper.mjs");
const { messageRoute } = await import("../routes/message.mjs");
const { Client } = await import("@upstash/workflow");

test("a scheduling API response is returned only after Redis write and QStash trigger", async (t) => {
  let release;
  let saved = false;
  const redis = { eval: async () => { saved = true; return 1; } };
  t.mock.method(redisManager, "getClient", () => redis);
  t.mock.method(Client.prototype, "trigger", () => new Promise((resolve) => { release = resolve; }));
  const app = Fastify();
  await app.register(messageRoute);
  t.after(() => app.close());
  const schedule = new Date(Date.now() + 3600000).toISOString().replace("T", " ").slice(0, 19);
  const pending = app.inject({ method: "POST", url: "/message", headers: { authorization: "Bearer workflow-test-key" }, payload: { recipient_type: "individual", to: "628123456789", type: "location", location: { latitude: -6.2, longitude: 106.8, address: "Jakarta" }, schedule } });
  for (let n = 0; !release && n < 100; n++) await new Promise((resolve) => setTimeout(resolve, 2));
  assert.equal(saved, true);
  assert.equal(typeof release, "function");
  release({ workflowRunId: "wfr_test" });
  const response = await pending;
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().message, "Message scheduled successfully");
});

test("failed trigger marks saved messages as enqueue_unknown", async (t) => {
  let transitions = 0;
  t.mock.method(redisManager, "getClient", () => ({ eval: async () => (++transitions === 1 ? 1 : "OK") }));
  t.mock.method(Client.prototype, "trigger", async () => { throw new Error("QStash unavailable"); });
  await assert.rejects(workflowManager.scheduleMessage("123@c.us", new wwebjs.Location(0, 0), {}, 5000), /QStash unavailable/);
  assert.equal(transitions, 2);
});
