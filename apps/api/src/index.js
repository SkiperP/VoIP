import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { AccessToken } from "livekit-server-sdk";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PUBLIC_DIR = join(ROOT, "public");

const PORT = Number.parseInt(process.env.APP_PORT ?? "8787", 10);
const API_KEY = process.env.LIVEKIT_API_KEY ?? "devkey";
const API_SECRET =
  process.env.LIVEKIT_API_SECRET ?? "thisisnotsecretthisisnotsecret1234";
const LIVEKIT_URL = process.env.LIVEKIT_URL ?? "ws://127.0.0.1:7880";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const NAME_RE = /^[\p{L}\p{N} ._-]{2,32}$/u;
const ROOM_RE = /^[A-Za-z0-9_-]{3,32}$/;

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function issueToken(identity, room) {
  const at = new AccessToken(API_KEY, API_SECRET, {
    identity,
    name: identity,
    ttl: "1h",
  });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });
  return at.toJwt();
}

async function serveStatic(req, res) {
  const url = new URL(req.url ?? "/", "http://local");
  let relative = decodeURIComponent(url.pathname);
  if (relative === "/") relative = "/index.html";
  const target = normalize(join(PUBLIC_DIR, relative));
  if (!target.startsWith(PUBLIC_DIR)) {
    json(res, 403, { error: "forbidden" });
    return;
  }
  try {
    const data = await readFile(target);
    res.writeHead(200, {
      "content-type": MIME[extname(target)] ?? "application/octet-stream",
    });
    res.end(data);
  } catch {
    if (extname(relative) === "") {
      const fallback = await readFile(join(PUBLIC_DIR, "index.html")).catch(
        () => null,
      );
      if (fallback) {
        res.writeHead(200, { "content-type": MIME[".html"] });
        res.end(fallback);
        return;
      }
    }
    json(res, 404, { error: "not found" });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://local");

  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      json(res, 200, { ok: true, livekitUrl: LIVEKIT_URL });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/token") {
      const body = await readJson(req);
      const identity = String(body.identity ?? "").trim();
      const room = String(body.room ?? "").trim();
      if (!NAME_RE.test(identity)) {
        json(res, 400, {
          error: "Имя: 2–32 символа, буквы/цифры/пробел/._-",
        });
        return;
      }
      if (!ROOM_RE.test(room)) {
        json(res, 400, {
          error: "Код комнаты: 3–32 символа, латиница, цифры, _-",
        });
        return;
      }
      const token = await issueToken(identity, room);
      json(res, 200, { token, url: LIVEKIT_URL, identity, room });
      return;
    }

    if (req.method === "GET") {
      await serveStatic(req, res);
      return;
    }

    json(res, 405, { error: "method not allowed" });
  } catch (err) {
    console.error(err);
    json(res, 500, { error: "internal error" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`line-api on :${PORT}  livekit=${LIVEKIT_URL}`);
});
