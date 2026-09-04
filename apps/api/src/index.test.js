import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { canonicalPath, livekitUrlFor } from "./public-url.js";

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
  assert.equal(health.livekitUrl, "ws://127.0.0.1:7880");
  const prefixed = await fetch(`${BASE}/call/api/health`).then((r) => r.json());
  assert.equal(prefixed.ok, true);
  const healthHeaders = await fetch(`${BASE}/api/health`);
  assert.match(
    healthHeaders.headers.get("permissions-policy") ?? "",
    /microphone=\(self\)/,
  );

  const viaProxy = await fetch(`${BASE}/api/health`, {
    headers: {
      "x-forwarded-proto": "https",
      "x-forwarded-host": "demo.trycloudflare.com",
    },
  }).then((r) => r.json());
  assert.equal(viaProxy.livekitUrl, "wss://demo.trycloudflare.com/lk");

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
  assert.equal(body.url, "ws://127.0.0.1:7880");

  const tunneled = await fetch(`${BASE}/api/token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "line.trycloudflare.com",
    },
    body: JSON.stringify({ identity: "Ann", room: "desk-4" }),
  }).then((r) => r.json());
  assert.equal(tunneled.url, "wss://line.trycloudflare.com/lk");
});

test("canonicalPath strips the /call prefix used in production", () => {
  assert.equal(canonicalPath("/api/health"), "/api/health");
  assert.equal(canonicalPath("/call"), "/");
  assert.equal(canonicalPath("/call/"), "/");
  assert.equal(canonicalPath("/call/api/health"), "/api/health");
  assert.equal(canonicalPath("/call/assets/app.js"), "/assets/app.js");
});

test("livekitUrlFor uses the proxy headers when present", () => {
  assert.equal(
    livekitUrlFor({ headers: {} }),
    "ws://127.0.0.1:7880",
  );
  assert.equal(
    livekitUrlFor({
      headers: {
        "x-forwarded-proto": "https",
        host: "badger-budget.ru",
      },
    }),
    "wss://badger-budget.ru/lk",
  );
});

test("health reports the quick-tunnel URL from disk", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "line-https-"));
  const urlFile = join(dir, "https-url");
  await writeFile(urlFile, "https://orange-lake-123.trycloudflare.com\n");
  const port = 18788;
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      APP_PORT: String(port),
      LIVEKIT_API_KEY: "devkey",
      LIVEKIT_API_SECRET: "thisisnotsecretthisisnotsecret1234",
      LIVEKIT_URL: "ws://127.0.0.1:7880",
      HTTPS_URL_FILE: urlFile,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => {
    child.kill("SIGTERM");
  });
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) {
        const body = await res.json();
        assert.equal(
          body.httpsPublicUrl,
          "https://orange-lake-123.trycloudflare.com",
        );
        return;
      }
    } catch {
      // still booting
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("api did not start");
});
