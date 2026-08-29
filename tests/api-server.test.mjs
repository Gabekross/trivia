import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import test from "node:test";

const port = 49173;
const baseUrl = `http://127.0.0.1:${port}`;

test("dev server exposes trusted mutation API with persistence", async () => {
  await rm("data", { recursive: true, force: true });
  const server = spawn(process.execPath, ["scripts/dev-server.mjs"], {
    env: { ...process.env, GAME_STORE: "json", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    await waitForServer(server);
    const created = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ title: "API Test", winnerMode: "RACE_TO_X", targetCorrect: 1 })
    });
    const joined = await api("/api/join", {
      method: "POST",
      body: JSON.stringify({ joinCode: created.joinCode, displayName: "API Player" })
    });
    const health = await api("/api/health");
    const bootstrap = await api("/api/bootstrap");
    const started = await api(`/api/sessions/${created.sessionId}/operator`, { method: "POST", body: JSON.stringify({ action: "START" }) });
    const operator = await api(`/api/sessions/${created.sessionId}/snapshot?role=OPERATOR`);
    const correct = operator.question.choices.find((choice) => choice.isCorrect);

    const accepted = await api(`/api/sessions/${created.sessionId}/answers`, {
      method: "POST",
      body: JSON.stringify({ playerId: joined.playerId, choiceId: correct.id, idempotencyKey: "api-answer" })
    });
    const player = await api(`/api/sessions/${created.sessionId}/snapshot?role=PLAYER&playerId=${joined.playerId}`);
    const byCode = await api(`/api/join-codes/${created.joinCode}`);
    const displayRoute = await fetch(`${baseUrl}/trivia/display/${created.sessionId}`);
    const displayHtml = await displayRoute.text();

    assert.equal(player.session.winner.playerId, joined.playerId);
    assert.equal(player.player.currentAnswer.choiceId, correct.id);
    assert.equal(created.snapshot.session.id, created.sessionId);
    assert.equal(joined.snapshot.player.id, joined.playerId);
    assert.equal(started.snapshot.session.status, "QUESTION_ACTIVE");
    assert.equal(accepted.snapshot.player.currentAnswer.choiceId, correct.id);
    assert.equal(health.ok, true);
    assert.equal(health.store, "json");
    assert.equal(byCode.sessionId, created.sessionId);
    assert.equal(typeof bootstrap.origins.current, "string");
    assert.equal(displayRoute.status, 200);
    assert.match(displayHtml, /Family Trivia Codex/);
    assert.match(displayHtml, /src="\/app\.mjs"/);
    assert.match(displayHtml, /href="\/styles\.css"/);
    assert.equal(existsSync("data/trivia-state.json"), true);
  } finally {
    server.kill();
  }
});

async function waitForServer(server) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`server exited before ready: ${server.exitCode}`);
    try {
      await api("/api/bootstrap");
      return;
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("server did not become ready");
}

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}
