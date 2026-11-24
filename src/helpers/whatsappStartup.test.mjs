import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";

process.env.NODE_ENV = "test";
process.env.WWEBJS_AUTH_TIMEOUT_MS = "45000";
process.env.WWEBJS_WEB_VERSION = "2.3000.1054759074";
process.env.WWEBJS_WEB_CACHE_PATH = "./test-web-cache";

const { client, initializeWhatsApp, getClientState } = await import("../whatsappClient.mjs");
const { default: logger } = await import("../logger.mjs");

test("timeout options allow a strict locally cached WhatsApp Web version", () => {
  assert.equal(client.options.authTimeoutMs, 45000);
  assert.equal(client.options.webVersion, "2.3000.1054759074");
  assert.equal(client.options.webVersionCache.type, "local");
  assert.equal(client.options.webVersionCache.path, "./test-web-cache");
  assert.equal(client.options.webVersionCache.strict, true);
});

test("a pinned version missing from local cache fails instead of falling back", async () => {
  const directory = mkdtempSync(join(tmpdir(), "wwebjs-cache-test-"));
  try {
    const { default: LocalWebCache } = await import("whatsapp-web.js/src/webCache/LocalWebCache.js");
    const cache = new LocalWebCache({ ...client.options.webVersionCache, path: directory });
    await assert.rejects(cache.resolve(client.options.webVersion), /Couldn't load version/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("default startup options preserve upstream cache behavior", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    const { client } = await import('./src/whatsappClient.mjs');
    console.log(JSON.stringify({ timeout: client.options.authTimeoutMs, version: client.options.webVersion, strict: client.options.webVersionCache.strict ?? false }));
  `], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "test", WWEBJS_AUTH_TIMEOUT_MS: "", WWEBJS_WEB_VERSION: "", WWEBJS_WEB_CACHE_PATH: "" },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const options = JSON.parse(result.stdout.trim());
  assert.equal(options.timeout, 30000);
  assert.equal(options.strict, false);
});

test("invalid startup configuration is rejected before Chromium launches", () => {
  for (const vars of [
    { WWEBJS_AUTH_TIMEOUT_MS: "30000ms", WWEBJS_WEB_VERSION: "" },
    { WWEBJS_AUTH_TIMEOUT_MS: "0", WWEBJS_WEB_VERSION: "" },
    { WWEBJS_AUTH_TIMEOUT_MS: "30000", WWEBJS_WEB_VERSION: "../malicious" },
  ]) {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", "await import('./src/config.mjs')"], {
      cwd: process.cwd(), env: { ...process.env, ...vars }, encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CONFIGURATION_ERROR/);
  }
});

test("login-route startup timeout records bounded diagnostics before browser cleanup", async (t) => {
  const timeout = new Error("Waiting failed: 45000ms exceeded");
  timeout.name = "TimeoutError";
  const events = [];
  t.mock.method(logger, "warn", (fields, message) => events.push({ fields, message }));
  t.mock.method(client, "destroy", async () => events.push({ event: "destroy" }));
  t.mock.method(client, "initialize", async () => {
    client.pupPage = {
      async evaluate(fn) {
        events.push({ event: "evaluate" });
        return vm.runInNewContext(`(${fn.toString()})()`, {
          location: { pathname: "/login/", href: "https://web.whatsapp.com/login/?token=private" },
          document: { readyState: "complete" },
          Debug: { VERSION: "2.3000.1055852612" },
          require: () => null,
        });
      },
    };
    throw timeout;
  });
  t.after(() => { client.pupPage = null; });
  await assert.rejects(initializeWhatsApp(), (error) => error === timeout);
  assert.equal(getClientState(), "DISCONNECTED");
  const diagnostic = events.find((event) => event.fields?.diagnostic)?.fields?.diagnostic;
  assert.equal(diagnostic.page, "login");
  assert.equal(diagnostic.webVersion, "2.3000.1055852612");
  assert.equal(diagnostic.hasSocketModel, false);
  assert.equal(diagnostic.socketState, null);
  assert.ok(events.findIndex((event) => event.event === "evaluate") < events.findIndex((event) => event.event === "destroy"));
  assert.doesNotMatch(JSON.stringify(events), /token=private/);
});

test("startup preserves the original timeout when browser inspection fails", async (t) => {
  const timeout = new Error("Waiting failed: 45000ms exceeded");
  timeout.name = "TimeoutError";
  t.mock.method(client, "destroy", async () => {});
  t.mock.method(client, "initialize", async () => {
    client.pupPage = { async evaluate() { throw new Error("page closed"); } };
    throw timeout;
  });
  t.after(() => { client.pupPage = null; });
  await assert.rejects(initializeWhatsApp(), (error) => error === timeout);
  assert.equal(getClientState(), "DISCONNECTED");
});

test("socket opening state is distinguished from the incompatible login route", async (t) => {
  const timeout = new Error("Waiting failed: 45000ms exceeded");
  timeout.name = "TimeoutError";
  const events = [];
  t.mock.method(logger, "warn", (fields, message) => events.push({ fields, message }));
  t.mock.method(client, "destroy", async () => {});
  t.mock.method(client, "initialize", async () => {
    client.pupPage = { async evaluate(fn) {
      return vm.runInNewContext(`(${fn.toString()})()`, {
        location: { pathname: "/" },
        document: { readyState: "complete" },
        Debug: { VERSION: "2.3000.1055852612" },
        require: () => ({ Socket: { state: "OPENING" } }),
      });
    } };
    throw timeout;
  });
  t.after(() => { client.pupPage = null; });
  await assert.rejects(initializeWhatsApp(), (error) => error === timeout);
  const diagnostic = events.find((event) => event.fields?.diagnostic).fields.diagnostic;
  assert.equal(diagnostic.page, "other");
  assert.equal(diagnostic.socketState, "OPENING");
  assert.equal(diagnostic.hasSocketModel, true);
  assert.equal(events.some((event) => event.message?.includes("#201988")), false);
});
