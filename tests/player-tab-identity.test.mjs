import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("player identity is stored per tab instead of shared across browser windows", async () => {
  const appSource = await readFile("src/web/app.mjs", "utf8");

  assert.match(appSource, /sessionStorage\.setItem\(playerStorageKey\(\), playerId\)/);
  assert.doesNotMatch(appSource, /localStorage\.setItem\("trivia\.playerId"/);
  assert.doesNotMatch(appSource, /localStorage\.getItem\("trivia\.playerId"/);
});
