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

  if (request.method === "GET" && url.pathname === "/api/client-config") {
    sendJson(response, 200, {
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || null,
      supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || null,
      realtime: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/qr") {
    const data = url.searchParams.get("data") || "";
    if (!data || data.length > 512) {
      sendJson(response, 400, { error: "QR data is required and must be 512 characters or fewer." });
      return;
    }
    const svg = await createQrSvg(data);
    send(response, 200, "image/svg+xml; charset=utf-8", svg);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/bootstrap") {
    const session = await store.bootstrap();
    sendJson(response, 200, { ...session, origins: getOrigins?.(request) || defaultOrigins(request) });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/questions") {
    if (!isOperatorAuthorized(request)) return sendUnauthorized(response);
    sendJson(response, 200, { questions: await store.listQuestions() });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/questions") {
    if (!isOperatorAuthorized(request)) return sendUnauthorized(response);
    const question = await store.saveQuestion(await readJson(request));
    sendJson(response, 201, { question });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/questions/generate") {
    if (!isOperatorAuthorized(request)) return sendUnauthorized(response);
    const questions = await store.generateQuestionDrafts(await readJson(request));
    sendJson(response, 201, { questions });
    return;
  }

  const questionReviewMatch = url.pathname.match(/^\/api\/questions\/([^/]+)\/review$/);
  if (questionReviewMatch && request.method === "POST") {
    if (!isOperatorAuthorized(request)) return sendUnauthorized(response);
    const body = await readJson(request);
    const question = await store.reviewQuestion(decodeURIComponent(questionReviewMatch[1]), body.action);
    sendJson(response, 200, { question });
    return;
  }

  const questionMatch = url.pathname.match(/^\/api\/questions\/([^/]+)$/);
  if (questionMatch && request.method === "PUT") {
    if (!isOperatorAuthorized(request)) return sendUnauthorized(response);
    const question = await store.saveQuestion({ ...(await readJson(request)), id: decodeURIComponent(questionMatch[1]) });
    sendJson(response, 200, { question });
    return;
  }

  if (questionMatch && request.method === "DELETE") {
    if (!isOperatorAuthorized(request)) return sendUnauthorized(response);
    const question = await store.archiveQuestion(decodeURIComponent(questionMatch[1]));
    sendJson(response, 200, { question });
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
    await advanceTimers({ store, eventHub, sessionId: snapshotMatch[1] });
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
    await store.publishEvent(created.sessionId, "SESSION_CREATED");
    sendJson(response, 201, {
      sessionId: created.sessionId,
      joinCode: created.joinCode,
      snapshot: await store.getSnapshot(created.sessionId, "OPERATOR")
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/join") {
    const body = await readJson(request);
    const joined = await store.joinSession(body.joinCode, body.displayName);
    eventHub?.broadcast(joined.sessionId, "PLAYER_JOINED");
    await store.publishEvent(joined.sessionId, "PLAYER_JOINED");
    sendJson(response, 201, {
      sessionId: joined.sessionId,
      playerId: joined.playerId,
      snapshot: await store.getSnapshot(joined.sessionId, "PLAYER", joined.playerId)
    });
    return;
  }

  const operatorMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/operator$/);
  if (request.method === "POST" && operatorMatch) {
    if (!isOperatorAuthorized(request)) return sendUnauthorized(response);
    const body = await readJson(request);
    const updated = await store.operatorAction(operatorMatch[1], body.action);
    eventHub?.broadcast(updated.session.id, body.action);
    await store.publishEvent(updated.session.id, body.action);
    sendJson(response, 200, { ok: true, snapshot: await store.getSnapshot(updated.session.id, "OPERATOR") });
    return;
  }

  const answerMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/answers$/);
  if (request.method === "POST" && answerMatch) {
    const body = await readJson(request);
    const { answer } = await store.submitAnswer({ sessionId: answerMatch[1], playerId: body.playerId, choiceId: body.choiceId, idempotencyKey: body.idempotencyKey });
    eventHub?.broadcast(answerMatch[1], "ANSWER_ACCEPTED");
    await store.publishEvent(answerMatch[1], "ANSWER_ACCEPTED");
    sendJson(response, 201, {
      answer,
      snapshot: await store.getSnapshot(answerMatch[1], "PLAYER", body.playerId)
    });
    return;
  }

  sendJson(response, 404, { error: "API route not found" });
}

async function advanceTimers({ store, eventHub, sessionId }) {
  const advanced = await store.advanceTimers(sessionId);
  if (!advanced?.advanced) return;
  const eventType = advanced.eventType || "SESSION_UPDATED";
  eventHub?.broadcast(sessionId, eventType);
  await store.publishEvent(sessionId, eventType);
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

function sendUnauthorized(response) {
  sendJson(response, 401, { error: "Operator authorization is required." });
}

function isOperatorAuthorized(request) {
  const expected = process.env.OPERATOR_SESSION_SECRET;
  if (!expected && process.env.NODE_ENV !== "production") return true;
  if (!expected) return false;
  return request.headers["x-operator-secret"] === expected;
}

function send(response, status, contentType, body) {
  response.writeHead(status, { "content-type": contentType });
  response.end(body);
}

function defaultOrigins(request) {
  const current = `http://${request.headers.host}`;
  return { current, lan: current };
}

async function createQrSvg(data) {
  const { default: QRCode } = await import("qrcode");
  return QRCode.toString(data, {
    type: "svg",
    margin: 1,
    width: 220,
    color: {
      dark: "#1f2933",
      light: "#ffffff"
    }
  });
}
