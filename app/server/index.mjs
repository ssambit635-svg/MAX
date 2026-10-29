import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { APP_ROOT, appendActivity, loadActivity, loadConfig, publicConfig, saveConfig } from "./store.mjs";
import { appCatalog, handleCommand, recentNotes, saveNote } from "./commands.mjs";
import { probeApps } from "./apps.mjs";
import { collectStats, invalidateStats, onStatsUpdated, verifyIntegration } from "./integrations.mjs";
import { catalog as languageCatalog, detectLanguage, getLanguage } from "./code/languages.mjs";
import { applyFixes, review } from "./code/engine.mjs";
import { defaultWorkspace, listWorkspace, readCodeFile, writeCodeFile } from "./code/files.mjs";
import { scanProject } from "./code/project.mjs";
import { deleteSnippet, findSnippet, saveSnippet, snippetIndex } from "./snippets.mjs";
import { clearLog, diagnosticsSummary, logEvent, readLog } from "./diagnostics.mjs";

const DEFAULT_HOST = process.env.MAX_HOST ?? "0.0.0.0";
const DEFAULT_PORT = Number(process.env.MAX_API_PORT ?? process.env.PORT ?? 7999);
const DIST = process.env.MAX_DIST_DIR ?? path.join(APP_ROOT, "dist");
const ASSETS = process.env.MAX_ASSETS_DIR ?? path.join(APP_ROOT, "assets");

const { VERSION } = await import("./version.mjs");

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

// Numbers that finish loading after the island has already drawn arrive here.
onStatsUpdated((stats) => broadcast("stats", { stats }));

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

const MAX_BODY_BYTES = Number(process.env.MAX_MAX_BODY ?? 2_000_000);

/** A bad request is the caller's mistake, so it must not look like a crash. */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      // Stop buffering, but answer before dropping the socket: destroying it first
      // turns a clear "too big" into a bare network error on the other side.
      req.pause();
      const error = new HttpError(413, "That's too much data for one request.");
      error.closeConnection = true;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "That request wasn't valid JSON.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "Expected a JSON object.");
  }
  return parsed;
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

  if (route === "GET /api/apps") {
    // Resolve every allowlisted app against this machine so the UI only offers what exists.
    return sendJson(res, 200, { apps: await probeApps() });
  }

  /* ------------------------------------------------------------------ code */

  if (route === "GET /api/code/meta") {
    return sendJson(res, 200, {
      languages: languageCatalog(),
      workspace: loadConfig().codeDir ?? defaultWorkspace(),
      files: listWorkspace(loadConfig().codeDir ?? defaultWorkspace()),
    });
  }

  if (route === "POST /api/code/review" && req.method === "POST") {
    const body = await readBody(req);
    const language = getLanguage(body?.language) ?? detectLanguage(body?.path);
    return sendJson(res, 200, { ...review(body?.code, language.id), language: language.id });
  }

  if (route === "POST /api/code/fix" && req.method === "POST") {
    const body = await readBody(req);
    const language = getLanguage(body?.language) ?? detectLanguage(body?.path);
    return sendJson(res, 200, applyFixes(body?.code, language.id));
  }

  if (route === "POST /api/code/open" && req.method === "POST") {
    const body = await readBody(req);
    return sendJson(res, 200, readCodeFile(body?.path, loadConfig().codeDir ?? defaultWorkspace()));
  }

  if (route === "GET /api/code/snippets") {
    return sendJson(res, 200, { snippets: snippetIndex() });
  }

  if (route === "POST /api/code/snippets" && req.method === "POST") {
    const body = await readBody(req);
    const result = saveSnippet(body?.name, body?.code);
    return sendJson(res, result.ok ? 200 : 400, result);
  }

  if (route === "POST /api/code/snippets/delete" && req.method === "POST") {
    const body = await readBody(req);
    const result = deleteSnippet(body?.name);
    return sendJson(res, result.ok ? 200 : 404, result);
  }

  if (route === "POST /api/code/snippet/copy" && req.method === "POST") {
    const body = await readBody(req);
    const found = findSnippet(body?.name);
    return sendJson(res, found ? 200 : 404, found ? { ok: true, snippet: found } : { ok: false, message: "No snippet by that name." });
  }

  if (route === "POST /api/code/scan" && req.method === "POST") {
    const body = await readBody(req);
    const target = body?.root || loadConfig().codeDir || defaultWorkspace();
    const result = scanProject(target);
    if (result.ok) logEvent("info", "project scanned", { files: result.summary.files, score: result.score });
    return sendJson(res, result.ok ? 200 : 400, result);
  }

  if (route === "GET /api/diagnostics") {
    return sendJson(res, 200, {
      version: VERSION,
      summary: diagnosticsSummary({ config: loadConfig(), stats: await collectStats() }),
      log: readLog(40),
    });
  }

  if (route === "POST /api/diagnostics/clear" && req.method === "POST") {
    return sendJson(res, 200, { ok: clearLog(), message: clearLog() ? "Log cleared." : "Nothing to clear." });
  }

  if (route === "POST /api/code/save" && req.method === "POST") {
    const body = await readBody(req);
    const result = writeCodeFile(body?.path, body?.code, loadConfig().codeDir ?? defaultWorkspace());
    if (result.ok) {
      appendActivity({ kind: "command", title: `Saved ${result.name}`, detail: `${result.language} · ${result.size} bytes` });
    }
    return sendJson(res, result.ok ? 200 : 400, result);
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
    if (body?.text !== undefined && typeof body.text !== "string") {
      return sendJson(res, 400, { ok: false, message: "A note has to be text." });
    }
    const text = String(body?.text ?? "").trim();
    if (!text) return sendJson(res, 400, { ok: false, message: "There is nothing to save yet." });
    if (text.length > 200_000) {
      return sendJson(res, 413, { ok: false, message: "That note is too long — keep it under 200,000 characters." });
    }
    const saved = saveNote(text, body?.name ? String(body.name) : undefined);
    if (!saved.ok) return sendJson(res, 200, { ok: false, message: saved.message, mood: "error" });
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

  return sendJson(res, 404, { ok: false, message: "I don't have that page." });
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
    // A rejection the caller caused is not a crash: report it as a plain sentence.
    if (error instanceof HttpError) {
      if (!res.headersSent) {
        if (error.closeConnection) res.setHeader("connection", "close");
        sendJson(res, error.status, { ok: false, message: error.message });
      } else {
        res.end();
      }
      // A half-read body would keep the parser waiting forever.
      if (error.closeConnection) setImmediate(() => req.destroy?.());
      return undefined;
    }
    console.error("[max] request failed", error);
    // Never leak a stack trace or an internal message to the island.
    if (!res.headersSent) sendJson(res, 500, { ok: false, message: "Something went wrong on my side. Try that again." });
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
      // Report the port the OS actually gave us, so port 0 (tests, a busy 7999) works.
      const bound = server.address();
      const actualPort = typeof bound === "object" && bound ? bound.port : port;
      console.log(`[max] island server on http://${host}:${actualPort}`);
      console.log(`[max] ui: ${DIST}`);
      console.log(`[max] notes: ${loadConfig().saveDir}`);
      resolve({ server, port: actualPort, close: () => new Promise((done) => server.close(done)) });
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
