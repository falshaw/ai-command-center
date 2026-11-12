// AI Command Center: a local home screen for a self-hosted app fleet, with a Claude Code terminal inside.
// Listens on 127.0.0.1 only. The embedded terminal is full control of the machine, so every request is checked
// (Host allowlist, Origin check, per-start token, strict CSP). See README.md, "Security model".
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { WebSocketServer } from "ws";
import { APP_DIR, CONFIG, PUBLIC_CONFIG } from "./lib/config.mjs";
import * as src from "./lib/sources.mjs";
import * as term from "./lib/term.mjs";

const HOST = "127.0.0.1"; // never 0.0.0.0
const PORT = Number(process.env.HUD_PORT) || CONFIG.port;
const ORIGIN = `http://${HOST}:${PORT}`;
const ALLOWED_HOSTS = new Set([`${HOST}:${PORT}`, `localhost:${PORT}`]);
const ALLOWED_ORIGINS = new Set([ORIGIN, `http://localhost:${PORT}`]);
const TOKEN = crypto.randomBytes(32).toString("hex"); // new on every start, only readable by our own page

const PUB = path.join(APP_DIR, "public");
const NM = path.join(APP_DIR, "node_modules");
const T = { js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8", html: "text/html; charset=utf-8" };
const STATIC = {
  "/": [path.join(PUB, "index.html"), T.html],
  "/app.js": [path.join(PUB, "app.js"), T.js],
  "/globe.js": [path.join(PUB, "globe.js"), T.js],
  "/style.css": [path.join(PUB, "style.css"), T.css],
  "/icon.svg": [path.join(PUB, "icon.svg"), "image/svg+xml"],
  "/vendor/xterm.js": [path.join(NM, "@xterm/xterm/lib/xterm.js"), T.js],
  "/vendor/xterm.css": [path.join(NM, "@xterm/xterm/css/xterm.css"), T.css],
  "/vendor/addon-fit.js": [path.join(NM, "@xterm/addon-fit/lib/addon-fit.js"), T.js],
  "/vendor/three.min.js": [path.join(NM, "three/build/three.min.js"), T.js],
  "/vendor/topojson-client.min.js": [path.join(NM, "topojson-client/dist/topojson-client.min.js"), T.js],
  "/vendor/land-110m.json": [path.join(NM, "world-atlas/land-110m.json"), "application/json; charset=utf-8"],
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data:; " +
    `connect-src 'self' ws://${HOST}:${PORT} ws://localhost:${PORT}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
};

const hostOk = (req) => ALLOWED_HOSTS.has(req.headers.host || "");
const originOk = (req) => ALLOWED_ORIGINS.has(req.headers.origin || "");
const tokenOk = (given) =>
  typeof given === "string" && given.length === TOKEN.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(TOKEN));

function send(res, code, body, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "Content-Type": type, ...SECURITY_HEADERS });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

// Every source isolated: an error becomes {error} for that panel only.
const safe = async (fn) => {
  try {
    return { data: await fn() };
  } catch (e) {
    return { error: e.message || String(e) };
  }
};

function readBody(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("too large")); req.destroy(); } else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (!hostOk(req)) return send(res, 421, { error: "bad host" }); // DNS-rebinding guard
  const url = new URL(req.url, ORIGIN);
  try {
    if (req.method === "GET" && STATIC[url.pathname]) {
      const [file, type] = STATIC[url.pathname];
      let body = fs.readFileSync(file);
      if (url.pathname === "/") body = body.toString("utf8").replace("__HUD_TOKEN__", TOKEN);
      return send(res, 200, body, type);
    }
    if (url.pathname === "/health") return send(res, 200, { ok: true });
    if (url.pathname === "/favicon.ico") { res.writeHead(301, { Location: "/icon.svg" }); return res.end(); }

    if (url.pathname.startsWith("/api/")) {
      if (!tokenOk(req.headers["x-hud-token"])) return send(res, 403, { error: "forbidden" });
      if (req.method === "GET" && url.pathname === "/api/config") return send(res, 200, PUBLIC_CONFIG);
      if (req.method === "GET" && url.pathname === "/api/today") {
        const [today, tasks] = await Promise.all([safe(async () => src.today()), safe(async () => src.tasks())]);
        return send(res, 200, { date: src.localToday(), today, tasks });
      }
      if (req.method === "GET" && url.pathname === "/api/feeds") {
        const feeds = await Promise.all(CONFIG.feeds.map(async (f) => ({ id: f.id, label: f.label, ...(await safe(async () => src.feed(f.id))) })));
        return send(res, 200, { feeds });
      }
      if (req.method === "GET" && url.pathname === "/api/fleet") {
        const [containers, services] = await Promise.all([safe(src.containers), safe(src.services)]);
        return send(res, 200, { containers, services });
      }
      if (req.method === "POST" && url.pathname === "/api/start") {
        if (!originOk(req)) return send(res, 403, { error: "forbidden" });
        const { app } = JSON.parse((await readBody(req)) || "{}");
        try { return send(res, 200, src.startApp(String(app || ""))); } catch (e) { return send(res, 400, { error: e.message }); }
      }
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: e.message || "error" });
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, ORIGIN);
  if (url.pathname !== "/term" || !hostOk(req) || !originOk(req) || !tokenOk(url.searchParams.get("token"))) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, (ws) => term.attach(ws));
});

server.listen(PORT, HOST, () => console.log(`[hud] listening on ${ORIGIN} (config: ${path.relative(APP_DIR, CONFIG.file)})`));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => (term.shutdown(), process.exit(0)));
