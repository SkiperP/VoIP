import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LIVEKIT_URL = process.env.LIVEKIT_URL ?? "ws://127.0.0.1:7880";
const HTTPS_URL_FILE =
  process.env.HTTPS_URL_FILE ?? join(ROOT, "runtime", "https-url");

export function canonicalPath(pathname) {
  if (pathname === "/call" || pathname.startsWith("/call/")) {
    return pathname.slice("/call".length) || "/";
  }
  return pathname;
}

export function livekitUrlFor(req) {
  const xfProto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim();
  if (host && (xfProto === "https" || xfProto === "http")) {
    const ws = xfProto === "https" ? "wss" : "ws";
    return `${ws}://${host}/lk`;
  }
  return LIVEKIT_URL;
}

export function readHttpsPublicUrl() {
  const fromEnv = String(process.env.HTTPS_PUBLIC_URL ?? "").trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  try {
    const fromFile = readFileSync(HTTPS_URL_FILE, "utf8").trim();
    return fromFile.replace(/\/$/, "") || null;
  } catch {
    return null;
  }
}
