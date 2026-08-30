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
    env: { ...process.env, GAME_STORE: "json", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "", OPERATOR_SESSION_SECRET: "test-operator-key", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    await waitForServer(server);
    const created = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ title: "API Test", winnerMode: "RACE_TO_X", targetCorrect: 1 })
    });
    const paddedJoinCode = ` ${created.joinCode.toLowerCase()} `;
    const joined = await api("/api/join", {
      method: "POST",
      body: JSON.stringify({ joinCode: paddedJoinCode, displayName: "API Player" })
    });
    const health = await api("/api/health");
    const clientConfig = await api("/api/client-config");
    const bootstrap = await api("/api/bootstrap");
    const unauthorizedQuestions = await fetch(`${baseUrl}/api/questions`);
    const savedQuestion = await operatorApi("/api/questions", {
      method: "POST",
      body: JSON.stringify({
        category: "Family",
        difficulty: "easy",
        prompt: "Who is testing the question builder?",
        explanation: "The operator wrote this question.",
        choices: [
          { text: "The operator", isCorrect: true },
          { text: "The projector", isCorrect: false },
          { text: "The timer", isCorrect: false },
          { text: "The lobby", isCorrect: false }
        ]
      })
    });
    const editedQuestion = await operatorApi(`/api/questions/${savedQuestion.question.id}`, {
      method: "PUT",
      body: JSON.stringify({ ...savedQuestion.question, difficulty: "medium" })
    });
    const reviewedQuestion = await operatorApi(`/api/questions/${savedQuestion.question.id}/review`, {
      method: "POST",
      body: JSON.stringify({ action: "LOCK" })
    });
    const generatedDrafts = await operatorApi("/api/questions/generate", {
      method: "POST",
      body: JSON.stringify({ preset: "FAMILY", topic: "road trips", category: "Family Night", difficulty: "easy", count: 2 })
    });
    const unauthorizedGenerate = await fetch(`${baseUrl}/api/questions/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ topic: "blocked" })
    });
    const unauthorizedReview = await fetch(`${baseUrl}/api/questions/${savedQuestion.question.id}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "APPROVE" })
    });
    const questions = await operatorApi("/api/questions");
    const archivedQuestion = await operatorApi(`/api/questions/${savedQuestion.question.id}`, { method: "DELETE" });
    const started = await api(`/api/sessions/${created.sessionId}/operator`, { method: "POST", body: JSON.stringify({ action: "START" }) });
    const operator = await api(`/api/sessions/${created.sessionId}/snapshot?role=OPERATOR`);
    const correct = operator.question.choices.find((choice) => choice.isCorrect);

    const accepted = await api(`/api/sessions/${created.sessionId}/answers`, {
      method: "POST",
      body: JSON.stringify({ playerId: joined.playerId, choiceId: correct.id, idempotencyKey: "api-answer" })
    });
    const player = await api(`/api/sessions/${created.sessionId}/snapshot?role=PLAYER&playerId=${joined.playerId}`);
    const byCode = await api(`/api/join-codes/${encodeURIComponent(paddedJoinCode)}`);
    const qr = await fetch(`${baseUrl}/api/qr?data=${encodeURIComponent(`${baseUrl}/trivia/session/${created.joinCode}`)}`);
    const qrSvg = await qr.text();
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
    assert.equal(clientConfig.realtime, false);
    assert.equal(unauthorizedQuestions.status, 401);
    assert.equal(savedQuestion.question.choices.filter((choice) => choice.isCorrect).length, 1);
    assert.equal(savedQuestion.question.reviewStatus, "approved");
    assert.equal(Array.isArray(savedQuestion.question.validationWarnings), true);
    assert.equal(editedQuestion.question.difficulty, "medium");
    assert.equal(reviewedQuestion.question.reviewStatus, "locked");
    assert.equal(generatedDrafts.questions.length, 2);
    assert.equal(generatedDrafts.questions.every((question) => question.reviewStatus === "needs_review"), true);
    assert.equal(generatedDrafts.questions[0].generationMetadata.topic, "road trips");
    assert.equal(unauthorizedGenerate.status, 401);
    assert.equal(unauthorizedReview.status, 401);
    assert.equal(questions.questions.some((question) => question.id === savedQuestion.question.id), true);
    assert.equal(archivedQuestion.question.archived, true);
    assert.equal(byCode.sessionId, created.sessionId);
    assert.equal(qr.status, 200);
    assert.match(qrSvg, /<svg/);
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

async function operatorApi(path, options = {}) {
  return api(path, {
    ...options,
    headers: { "x-operator-secret": "test-operator-key", ...(options.headers || {}) }
  });
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
