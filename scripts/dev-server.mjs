import { createServer } from "node:http";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { createHttpApp } from "../src/server/http-app.mjs";
import { createGameStore } from "../src/server/stores/index.mjs";

const root = join(process.cwd(), "src", "web");
const coreRoot = join(process.cwd(), "src", "core");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
const store = createGameStore();
const streams = new Map();

const initial = await store.bootstrap();
console.log(`Ready session ${initial.sessionId} (${initial.joinCode})`);

const handleRequest = createHttpApp({
  store,
  webRoot: root,
  coreRoot,
  getOrigins: requestOrigins,
  eventHub: { open: openEventStream, broadcast }
});

createServer(handleRequest).listen(port, host, () => {
  console.log(`Trivia app running at http://127.0.0.1:${port}`);
  for (const origin of localNetworkOrigins()) console.log(`LAN URL: ${origin}`);
});

function openEventStream(response, sessionId) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  response.write(`event: ready\ndata: ${JSON.stringify({ sessionId })}\n\n`);
  const set = streams.get(sessionId) || new Set();
  set.add(response);
  streams.set(sessionId, set);
  response.on("close", () => set.delete(response));
}

function broadcast(sessionId, type) {
  for (const response of streams.get(sessionId) || []) {
    response.write(`event: update\ndata: ${JSON.stringify({ type, at: new Date().toISOString() })}\n\n`);
  }
}

function requestOrigins(request) {
  const current = `http://${request.headers.host}`;
  return { current, lan: localNetworkOrigins()[0] || current };
}

function localNetworkOrigins() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => `http://${entry.address}:${port}`);
}
