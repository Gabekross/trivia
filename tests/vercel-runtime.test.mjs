import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Vercel entrypoint uses the shared HTTP app", async () => {
  const entrypoint = await readFile("api/index.mjs", "utf8");
  const config = JSON.parse(await readFile("vercel.json", "utf8"));
  const appSource = await readFile("src/server/http-app.mjs", "utf8");
  const clientSource = await readFile("src/web/app.mjs", "utf8");

  assert.match(entrypoint, /createHttpApp/);
  assert.match(entrypoint, /export default async function handler/);
  assert.equal(config.outputDirectory, "public");
  assert.deepEqual(config.rewrites, [{ source: "/(.*)", destination: "/api/index.mjs" }]);
  assert.match(appSource, /polling: true/);
  assert.match(clientSource, /setInterval/);
  assert.match(clientSource, /hasEditableFocus/);
  assert.match(clientSource, /focusout/);
  assert.match(clientSource, /pollInterval/);
});
