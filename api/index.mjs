import { join } from "node:path";
import { loadEnvFile } from "../src/server/env-file.mjs";
import { createHttpApp } from "../src/server/http-app.mjs";
import { createGameStore } from "../src/server/stores/index.mjs";

await loadEnvFile();

const store = createGameStore();
const handleRequest = createHttpApp({
  store,
  webRoot: join(process.cwd(), "src", "web"),
  coreRoot: join(process.cwd(), "src", "core"),
  getOrigins: requestOrigins
});

export default async function handler(request, response) {
  await handleRequest(request, response);
}

function requestOrigins(request) {
  const forwardedProto = request.headers["x-forwarded-proto"];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || "https";
  const host = request.headers["x-forwarded-host"] || request.headers.host;
  const current = `${proto}://${host}`;
  return { current, lan: current };
}
