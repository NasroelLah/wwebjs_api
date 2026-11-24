import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

// Run the real server without starting WhatsApp or touching the user's database.
test("client errors and rate limits do not terminate the server", { timeout: 30000 }, async (t) => {
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    const { startServer } = await import('./src/server.mjs');
    startServer();
  `], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "test",
      HOST_PORT: "0",
      API_KEY: "test-api-key",
      SQLITE_PATH: ":memory:",
      WEBHOOK_URL: "",
      ALLOWED_ORIGINS: "http://allowed.local",
      TRUSTED_PROXIES: "",
      RATE_LIMIT: "100",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill());

  let output = "";
  child.stderr.on("data", (chunk) => { output += chunk; });
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 20000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited before startup (${code}): ${output}`));
    });
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = /Server running at (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
  });

  let response = await fetch(`${base}/api`, { headers: { origin: "http://blocked.local" } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), null);

  response = await fetch(`${base}/message`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-api-key" },
    body: "{",
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).status, "error");

  for (let attempt = 0; attempt < 6; attempt++) {
    response = await fetch(`${base}/messages/batch`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-api-key",
        "x-forwarded-for": `192.0.2.${attempt + 1}`,
      },
      body: "{}",
    });
    assert.equal(response.status, attempt === 5 ? 429 : 400);
  }
  assert.match((await response.json()).message, /Too many batch requests/);

  response = await fetch(`${base}/health/live`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "alive");
});
