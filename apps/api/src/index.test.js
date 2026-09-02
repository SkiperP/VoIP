import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = 18787;
const BASE = `http://127.0.0.1:${PORT}`;

function startServer() {
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      APP_PORT: String(PORT),
      LIVEKIT_API_KEY: "devkey",
      LIVEKIT_API_SECRET: "thisisnotsecretthisisnotsecret1234",
      LIVEKIT_URL: "ws://127.0.0.1:7880",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return child;
}

async function waitForHealth(child) {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {
      // still booting
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const err = child.stderr.read()?.toString() ?? "";
  throw new Error(`api did not start: ${err}`);
}

test("token API issues a jwt and rejects bad rooms", async (t) => {
  const child = startServer();
  t.after(() => {
    child.kill("SIGTERM");
  });
  await waitForHealth(child);

  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  assert.equal(health.ok, true);

  const bad = await fetch(`${BASE}/api/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identity: "Ann", room: "x" }),
  });
  assert.equal(bad.status, 400);

  const ok = await fetch(`${BASE}/api/token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identity: "Анна", room: "desk-4" }),
  });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.room, "desk-4");
  assert.ok(typeof body.token === "string" && body.token.split(".").length === 3);
});
