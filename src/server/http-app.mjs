import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { deploymentConfig } from "./config.mjs";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".js": "text/javascript; charset=utf-8"
};

export function createHttpApp({ store, webRoot = join(process.cwd(), "src", "web"), coreRoot = join(process.cwd(), "src", "core"), getOrigins, eventHub = null } = {}) {
  if (!store) throw new Error("createHttpApp requires a store");

  return async function handleRequest(request, response) {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (url.pathname.startsWith("/api/")) {
        await handleApi({ request, response, url, store, getOrigins, eventHub });
        return;
      }
      await serveStatic({ response, pathname: url.pathname, webRoot, coreRoot });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
  };
}

async function handleApi({ request, response, url, store, getOrigins, eventHub }) {
  if (request.method === "GET" && url.pathname === "/api/health") {
    const config = deploymentConfig();
    sendJson(response, config.ok ? 200 : 500, {
      ok: config.ok,
      store: config.gameStore,
      production: config.isProduction,
      warnings: config.warnings,
      errors: config.errors
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/bootstrap") {
    const session = await store.bootstrap();
    sendJson(response, 200, { ...session, origins: getOrigins?.(request) || defaultOrigins(request) });
    return;
  }

  const joinCodeMatch = url.pathname.match(/^\/api\/join-codes\/([^/]+)$/);
  if (request.method === "GET" && joinCodeMatch) {
    const session = await store.findSessionByJoinCode(decodeURIComponent(joinCodeMatch[1]));
    if (!session) {
      sendJson(response, 404, { error: "Join code not found" });
      return;
    }
    sendJson(response, 200, { sessionId: session.sessionId, joinCode: session.joinCode });
    return;
  }

  const snapshotMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/snapshot$/);
  if (request.method === "GET" && snapshotMatch) {
    const role = url.searchParams.get("role") || "DISPLAY";
    const playerId = url.searchParams.get("playerId");
    sendJson(response, 200, await store.getSnapshot(snapshotMatch[1], role, playerId));
    return;
  }

  const eventsMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/events$/);
  if (request.method === "GET" && eventsMatch) {
    if (eventHub) {
      eventHub.open(response, eventsMatch[1]);
      return;
    }
    sendJson(response, 200, { ok: true, polling: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/sessions") {
    const created = await store.createSession(await readJson(request));
    eventHub?.broadcast(created.sessionId, "SESSION_CREATED");
    sendJson(response, 201, { sessionId: created.sessionId, joinCode: created.joinCode });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/join") {
    const body = await readJson(request);
    const joined = await store.joinSession(body.joinCode, body.displayName);
    eventHub?.broadcast(joined.sessionId, "PLAYER_JOINED");
    sendJson(response, 201, { sessionId: joined.sessionId, playerId: joined.playerId });
    return;
  }

  const operatorMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/operator$/);
  if (request.method === "POST" && operatorMatch) {
    const body = await readJson(request);
    const updated = await store.operatorAction(operatorMatch[1], body.action);
    eventHub?.broadcast(updated.session.id, body.action);
    sendJson(response, 200, { ok: true });
    return;
  }

  const answerMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/answers$/);
  if (request.method === "POST" && answerMatch) {
    const body = await readJson(request);
    const { answer } = await store.submitAnswer({ sessionId: answerMatch[1], playerId: body.playerId, choiceId: body.choiceId, idempotencyKey: body.idempotencyKey });
    eventHub?.broadcast(answerMatch[1], "ANSWER_ACCEPTED");
    sendJson(response, 201, { answer });
    return;
  }

  sendJson(response, 404, { error: "API route not found" });
}

async function serveStatic({ response, pathname, webRoot, coreRoot }) {
  const target = pathname === "/" ? "/index.html" : pathname;
  if (target === "/trivia" || target.startsWith("/trivia/")) {
    const body = await readFile(join(webRoot, "index.html"));
    send(response, 200, mime[".html"], body);
    return;
  }

  let filePath = normalize(join(webRoot, target));
  if (target.startsWith("/core/")) filePath = normalize(join(coreRoot, target.replace(/^\/core\//, "")));
  if (!filePath.startsWith(webRoot) && !filePath.startsWith(coreRoot)) throw new Error("Invalid path");

  const body = await readFile(filePath);
  send(response, 200, mime[extname(filePath)] || "application/octet-stream", body);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function sendJson(response, status, payload) {
  send(response, status, "application/json; charset=utf-8", JSON.stringify(payload));
}

function send(response, status, contentType, body) {
  response.writeHead(status, { "content-type": contentType });
  response.end(body);
}

function defaultOrigins(request) {
  const current = `http://${request.headers.host}`;
  return { current, lan: current };
}
