import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

process.env.NODE_ENV = "test";
process.env.API_KEY = "test-api-key";
const { validateApiKey } = await import("../middleware/auth.mjs");
const { adminRoute } = await import("./admin.mjs");
const { AppError } = await import("../errors/AppError.mjs");

const AUTH = { authorization: "Bearer test-api-key" };

function fakeStore(overrides = {}) {
  const rows = new Map();
  const store = {
    rows,
    healthCheck: async () => true,
    listMessagesByStatus: async ({ status }) => ({
      status,
      total: 0,
      limit: 50,
      offset: 0,
      items: [...rows.values()].filter((row) => row.status === status),
    }),
    getMessageStatusSummary: async () => ({ scheduled: 2, sent: 5, failed: 1 }),
    getMessageById: async (id) => rows.get(id) ?? null,
    updateMessageStatus: async (id, status) => {
      rows.get(id).status = status;
    },
    deleteMessage: async (id) => {
      rows.delete(id);
    },
    ...overrides,
  };
  return store;
}

function message(id, status, extra = {}) {
  return {
    id,
    chatId: "628100@c.us",
    status,
    scheduledTime: new Date("2030-01-01T00:00:00Z"),
    createdAt: new Date("2029-12-31T00:00:00Z"),
    updatedAt: new Date("2029-12-31T00:00:00Z"),
    content: { format: "nas-wapi-scheduled-v1", type: "text", value: "hello" },
    options: {},
    ...extra,
  };
}

async function buildApp(options = {}) {
  const app = Fastify();
  app.decorate("authenticate", async (request, reply) => validateApiKey(request, reply));
  app.setErrorHandler((error, _request, reply) => {
    const status = error instanceof AppError ? error.statusCode : error.statusCode ?? 500;
    reply.status(status).send({ status: "error", message: error.message });
  });
  await app.register(adminRoute, options);
  return app;
}

const PROTECTED = [
  ["GET", "/admin/api/me"],
  ["GET", "/admin/api/summary"],
  ["GET", "/admin/api/queue"],
  ["GET", "/admin/api/device/status"],
  ["POST", "/admin/api/device/connect"],
  ["DELETE", "/admin/api/device/remove"],
  ["GET", "/admin/api/schedules"],
  ["GET", "/admin/api/schedules/msg-1"],
  ["PATCH", "/admin/api/schedules/msg-1/status"],
  ["DELETE", "/admin/api/schedules/msg-1"],
];

test("every admin API route rejects missing or wrong bearer tokens", async (t) => {
  const app = await buildApp({ store: fakeStore() });
  t.after(() => app.close());

  for (const [method, url] of PROTECTED) {
    const missing = await app.inject({ method, url });
    assert.equal(missing.statusCode, 401, `${method} ${url} without auth`);
    const wrong = await app.inject({ method, url, headers: { authorization: "Bearer nope" } });
    assert.equal(wrong.statusCode, 401, `${method} ${url} with wrong key`);
  }
});

test("/admin page is public but carries no data and disables caching", async (t) => {
  const app = await buildApp({ store: fakeStore() });
  t.after(() => app.close());

  const res = await app.inject({ method: "GET", url: "/admin" });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /text\/html/);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.doesNotMatch(res.body, /test-api-key/);
  // Untrusted data must be written with textContent, never innerHTML.
  assert.doesNotMatch(res.body, /innerHTML\s*=\s*['"]?[^;]*\+/);
});

test("schedules list rejects unknown status filters", async (t) => {
  const app = await buildApp({ store: fakeStore() });
  t.after(() => app.close());

  const res = await app.inject({ method: "GET", url: "/admin/api/schedules?status=bogus", headers: AUTH });
  assert.equal(res.statusCode, 400);
});

test("schedules list accepts every known status", async (t) => {
  const app = await buildApp({ store: fakeStore() });
  t.after(() => app.close());

  for (const status of ["scheduled", "processing", "sent", "failed", "unknown", "enqueue_unknown", "cancelled"]) {
    const res = await app.inject({ method: "GET", url: `/admin/api/schedules?status=${status}`, headers: AUTH });
    assert.equal(res.statusCode, 200, status);
    assert.equal(res.json().data.status, status);
  }
});

test("schedule items expose allowed transitions and never include media bytes", async (t) => {
  const store = fakeStore();
  store.rows.set("u-1", message("u-1", "unknown", {
    content: { format: "nas-wapi-scheduled-v1", type: "media", value: { mimetype: "image/png", filename: "a.png", filesize: 3, data: "AAAA" } },
    options: { caption: "x", media: { mimetype: "image/png", data: "BBBB" } },
  }));
  const app = await buildApp({ store });
  t.after(() => app.close());

  const res = await app.inject({ method: "GET", url: "/admin/api/schedules/u-1", headers: AUTH });
  assert.equal(res.statusCode, 200);
  const body = res.json().data;
  assert.deepEqual(body.allowedTransitions, ["sent", "failed"]);
  assert.equal(body.deletable, false);
  assert.equal(body.content.dataIncluded, false);
  assert.equal(body.content.data, undefined);
  assert.equal(body.options.media.data, undefined);
  assert.equal(res.body.includes("AAAA"), false);
  assert.equal(res.body.includes("BBBB"), false);
});

test("overrides cannot move a message back to scheduled or resend unknown", async (t) => {
  const store = fakeStore();
  store.rows.set("u-1", message("u-1", "unknown"));
  store.rows.set("p-1", message("p-1", "processing"));
  store.rows.set("s-1", message("s-1", "scheduled"));
  const app = await buildApp({ store });
  t.after(() => app.close());

  const patch = (id, status) => app.inject({
    method: "PATCH",
    url: `/admin/api/schedules/${id}/status`,
    headers: { ...AUTH, "content-type": "application/json" },
    payload: JSON.stringify({ status }),
  });

  assert.equal((await patch("u-1", "scheduled")).statusCode, 400);
  assert.equal((await patch("u-1", "processing")).statusCode, 400);
  assert.equal((await patch("p-1", "failed")).statusCode, 409);
  assert.equal((await patch("p-1", "sent")).statusCode, 409);
  assert.equal(store.rows.get("u-1").status, "unknown");
  assert.equal(store.rows.get("p-1").status, "processing");
});

test("unknown is resolved only by manual confirmation or failure, with compare-and-set", async (t) => {
  const calls = [];
  const store = fakeStore({
    updateMessageStatus: async (id, status, opts) => {
      calls.push({ id, status, opts });
    },
  });
  store.rows.set("u-1", message("u-1", "unknown"));
  const app = await buildApp({ store });
  t.after(() => app.close());

  const res = await app.inject({
    method: "PATCH",
    url: "/admin/api/schedules/u-1/status",
    headers: { ...AUTH, "content-type": "application/json" },
    payload: JSON.stringify({ status: "sent" }),
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls, [{ id: "u-1", status: "sent", opts: { expectedStatus: "unknown" } }]);
});

test("delete is refused for scheduled, processing and unknown messages", async (t) => {
  const store = fakeStore();
  store.rows.set("p-1", message("p-1", "processing"));
  store.rows.set("u-1", message("u-1", "unknown"));
  store.rows.set("f-1", message("f-1", "failed"));
  const app = await buildApp({ store });
  t.after(() => app.close());

  assert.equal((await app.inject({ method: "DELETE", url: "/admin/api/schedules/p-1", headers: AUTH })).statusCode, 409);
  assert.equal((await app.inject({ method: "DELETE", url: "/admin/api/schedules/u-1", headers: AUTH })).statusCode, 409);
  assert.equal(store.rows.has("p-1"), true);
  assert.equal(store.rows.has("u-1"), true);

  const ok = await app.inject({ method: "DELETE", url: "/admin/api/schedules/f-1", headers: AUTH });
  assert.equal(ok.statusCode, 200);
  assert.equal(store.rows.has("f-1"), false);
});

test("invalid message ids are rejected before touching the store", async (t) => {
  let touched = false;
  const store = fakeStore({ getMessageById: async () => { touched = true; return null; } });
  const app = await buildApp({ store });
  t.after(() => app.close());

  const res = await app.inject({ method: "GET", url: "/admin/api/schedules/bad%20id%3B%20x", headers: AUTH });
  assert.equal(res.statusCode, 400);
  assert.equal(touched, false);
});

test("missing messages return 404 for detail, override and delete", async (t) => {
  const app = await buildApp({ store: fakeStore() });
  t.after(() => app.close());

  assert.equal((await app.inject({ method: "GET", url: "/admin/api/schedules/nope", headers: AUTH })).statusCode, 404);
  assert.equal((await app.inject({
    method: "PATCH",
    url: "/admin/api/schedules/nope/status",
    headers: { ...AUTH, "content-type": "application/json" },
    payload: JSON.stringify({ status: "failed" }),
  })).statusCode, 404);
  assert.equal((await app.inject({ method: "DELETE", url: "/admin/api/schedules/nope", headers: AUTH })).statusCode, 404);
});

test("queue summary reports Redis counts and marks queueMonitor unavailable", async (t) => {
  const app = await buildApp({ store: fakeStore() });
  t.after(() => app.close());

  const res = await app.inject({ method: "GET", url: "/admin/api/queue", headers: AUTH });
  assert.equal(res.statusCode, 200);
  const { data } = res.json();
  assert.equal(data.source, "redis");
  assert.equal(data.counts.scheduled, 2);
  assert.equal(data.counts.processing, null, "unreported status must be null, not 0");
  assert.equal(data.monitor.available, false);
});

test("summary health reflects Redis and WhatsApp state", async (t) => {
  const app = await buildApp({
    store: fakeStore({ healthCheck: async () => false }),
    whatsapp: { getInfo: () => undefined, getClientState: () => "DISCONNECTED", isClientReady: () => false },
  });
  t.after(() => app.close());

  const res = await app.inject({ method: "GET", url: "/admin/api/summary", headers: AUTH });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().data.health.status, "degraded");
  assert.equal(res.json().data.health.services.redis, "unhealthy");
});

test("device actions delegate to the device controller", async (t) => {
  const seen = [];
  const reply = (name) => async (_request, reply) => {
    seen.push(name);
    return reply.send({ status: "success", message: name, data: null });
  };
  const app = await buildApp({
    store: fakeStore(),
    device: {
      getDeviceStatus: reply("status"),
      connectDevice: reply("connect"),
      removeDevice: reply("remove"),
    },
  });
  t.after(() => app.close());

  assert.equal((await app.inject({ method: "GET", url: "/admin/api/device/status", headers: AUTH })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/admin/api/device/connect", headers: AUTH })).statusCode, 200);
  assert.equal((await app.inject({ method: "DELETE", url: "/admin/api/device/remove", headers: AUTH })).statusCode, 200);
  assert.deepEqual(seen, ["status", "connect", "remove"]);
});
