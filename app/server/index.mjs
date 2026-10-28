import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_ROOT, appendActivity, loadActivity, loadConfig, publicConfig, saveConfig } from "./store.mjs";
import { appCatalog, handleCommand, recentNotes, saveNote } from "./commands.mjs";
import { collectStats, invalidateStats, verifyIntegration } from "./integrations.mjs";

const DEFAULT_HOST = process.env.MAX_HOST ?? "0.0.0.0";
const DEFAULT_PORT = Number(process.env.MAX_API_PORT ?? process.env.PORT ?? 7999);
const DIST = process.env.MAX_DIST_DIR ?? path.join(APP_ROOT, "dist");
const ASSETS = process.env.MAX_ASSETS_DIR ?? path.join(APP_ROOT, "assets");

const VERSION = process.env.MAX_VERSION || (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(APP_ROOT, "package.json"), "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

const clients = new Set();

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function broadcast(event, payload) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    try {
      client.write(frame);
    } catch {
      clients.delete(client);
    }
  }
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function serveFile(res, file) {
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "cache-control": file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=3600" : "no-cache",
    });
    fs.createReadStream(file).pipe(res);
  });
}

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;

  if (route === "GET /api/health") {
    return sendJson(res, 200, { ok: true, name: "MAX", version: VERSION, uptimeSeconds: Math.round(process.uptime()) });
  }

  if (route === "GET /api/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    clients.add(res);
    const keepAlive = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        clearInterval(keepAlive);
        clients.delete(res);
      }
    }, 25_000);
    req.on("close", () => {
      clearInterval(keepAlive);
      clients.delete(res);
    });
    return undefined;
  }

  if (route === "GET /api/state") {
    const stats = await collectStats();
    return sendJson(res, 200, {
      version: VERSION,
      config: publicConfig(),
      stats,
      activity: loadActivity(),
      notes: recentNotes(),
      apps: appCatalog(),
      platform: process.platform,
    });
  }

  if (route === "GET /api/stats") {
    if (url.searchParams.get("force") === "1") invalidateStats();
    return sendJson(res, 200, await collectStats());
  }

  if (route === "POST /api/command" && req.method === "POST") {
    const body = await readBody(req);
    const result = await handleCommand(body?.input);
    const entry = appendActivity({
      kind: result.mood === "error" ? "error" : "command",
      title: String(body?.input ?? "").slice(0, 120),
      detail: result.message,
    });
    broadcast("activity", { activity: entry, result });
    if (result.ui?.savedNote) broadcast("notes", { notes: recentNotes() });
    if (result.ui?.launched) invalidateStats();
    return sendJson(res, 200, result);
  }

  if (route === "GET /api/notes") return sendJson(res, 200, { notes: recentNotes(20) });

  if (route === "POST /api/notes") {
    const body = await readBody(req);
    const text = String(body?.text ?? "").trim();
    if (!text) return sendJson(res, 400, { ok: false, message: "There is nothing to save yet." });
    const saved = saveNote(text, body?.name ? String(body.name) : undefined);
    const entry = appendActivity({ kind: "note", title: `Saved ${saved.name}`, detail: text.slice(0, 120) });
    broadcast("activity", { activity: entry });
    broadcast("notes", { notes: recentNotes() });
    return sendJson(res, 200, { ok: true, message: `Saved as ${saved.name}.`, saved, notes: recentNotes() });
  }

  if (route === "POST /api/config") {
    const body = await readBody(req);
    saveConfig(body ?? {});
    invalidateStats();
    const stats = await collectStats();
    const config = publicConfig();
    broadcast("config", { config, stats });
    return sendJson(res, 200, { ok: true, config, stats });
  }

  if (route === "POST /api/integrations/verify") {
    const body = await readBody(req);
    const provider = String(body?.provider ?? "");
    const patch = {
      github: { username: body?.username ?? "", token: body?.token ?? "" },
      leetcode: { username: body?.username ?? "" },
      render: { apiKey: body?.apiKey ?? "" },
    }[provider];
    if (!patch) return sendJson(res, 400, { ok: false, message: "Unknown provider." });
    const result = await verifyIntegration(provider, patch);
    return sendJson(res, 200, result);
  }

  if (route === "POST /api/integrations/disconnect") {
    const body = await readBody(req);
    const provider = String(body?.provider ?? "");
    const patch = {
      github: { username: "", token: "" },
      leetcode: { username: "" },
      render: { apiKey: "" },
    }[provider];
    if (!patch) return sendJson(res, 400, { ok: false, message: "Unknown provider." });
    saveConfig(patch);
    invalidateStats();
    const stats = await collectStats();
    return sendJson(res, 200, { ok: true, config: publicConfig(), stats });
  }

  return sendJson(res, 404, { ok: false, message: `No route for ${route}` });
}

async function requestHandler(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);

    // Built UI first (dist/assets), then the app's own assets (icons, art).
    for (const root of [DIST, ASSETS]) {
      const file = path.join(root, requested);
      if (file.startsWith(root) && fs.existsSync(file) && fs.statSync(file).isFile()) return serveFile(res, file);
    }

    return serveFile(res, path.join(DIST, "index.html"));
  } catch (error) {
    console.error("[max] request failed", error);
    if (!res.headersSent) sendJson(res, 500, { ok: false, message: error.message ?? "Server error" });
    else res.end();
  }
  return undefined;
}

/**
 * Starts the local service. Resolves with the server instance and the port it actually
 * bound, so the desktop shell can move on to the next port when one is already taken.
 */
export function startServer({ port = DEFAULT_PORT, host = DEFAULT_HOST } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(requestHandler);
    const onError = (error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      server.on("error", (error) => console.error(`[max] service error: ${error.message}`));
      console.log(`[max] island server on http://${host}:${port}`);
      console.log(`[max] ui: ${DIST}`);
      console.log(`[max] notes: ${loadConfig().saveDir}`);
      resolve({ server, port, close: () => new Promise((done) => server.close(done)) });
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

// `node server/index.mjs` keeps the original single-process behaviour (dev + CI smoke test).
function invokedDirectly() {
  if (!process.argv[1]) return false;
  const self = path.resolve(fileURLToPath(import.meta.url));
  const entry = path.resolve(process.argv[1]);
  return process.platform === "win32" ? self.toLowerCase() === entry.toLowerCase() : self === entry;
}
if (invokedDirectly()) {
  startServer()
    .then(({ close }) => {
      process.on("SIGTERM", () => close().then(() => process.exit(0)));
      process.on("SIGINT", () => close().then(() => process.exit(0)));
    })
    .catch((error) => {
      console.error(`[max] could not start the local service: ${error.message}`);
      process.exit(1);
    });
}
