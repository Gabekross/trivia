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
    env: {
      ...process.env,
      GAME_STORE: "json",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      OPERATOR_SESSION_SECRET: "test-operator-key",
      RATE_LIMIT_QR_MAX: "1",
      RATE_LIMIT_WINDOW_MS: "60000",
      PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    await waitForServer(server);
    const unauthorizedCreate = await fetch(`${baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Blocked Session" })
    });
    const created = await operatorApi("/api/sessions", {
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
    const unauthorizedHistory = await fetch(`${baseUrl}/api/session-history`);
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
    const unauthorizedOperator = await fetch(`${baseUrl}/api/sessions/${created.sessionId}/operator`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "START" })
    });
    const started = await operatorApi(`/api/sessions/${created.sessionId}/operator`, { method: "POST", body: JSON.stringify({ action: "START" }) });
    const rejoined = await api("/api/join", {
      method: "POST",
      body: JSON.stringify({ joinCode: created.joinCode, displayName: "", playerId: joined.playerId })
    });
    const couplesSession = await operatorApi("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ title: "Couples Test", winnerMode: "COUPLES_MATCH", targetCoupleMatches: 1 })
    });
    const couplePlayer = await api("/api/join", {
      method: "POST",
      body: JSON.stringify({ joinCode: couplesSession.joinCode, displayName: "Partner One", pairCode: "Table 4" })
    });
    const unauthorizedOperatorSnapshot = await fetch(`${baseUrl}/api/sessions/${created.sessionId}/snapshot?role=OPERATOR`);
    const operator = await operatorApi(`/api/sessions/${created.sessionId}/snapshot?role=OPERATOR`);
    const correct = operator.question.choices.find((choice) => choice.isCorrect);

    const accepted = await api(`/api/sessions/${created.sessionId}/answers`, {
      method: "POST",
      body: JSON.stringify({ playerId: joined.playerId, choiceId: correct.id, idempotencyKey: "api-answer" })
    });
    const player = await api(`/api/sessions/${created.sessionId}/snapshot?role=PLAYER&playerId=${joined.playerId}`);
    await operatorApi(`/api/sessions/${created.sessionId}/operator`, { method: "POST", body: JSON.stringify({ action: "ACK_WINNER" }) });
    await operatorApi(`/api/sessions/${created.sessionId}/operator`, { method: "POST", body: JSON.stringify({ action: "END" }) });
    const history = await operatorApi("/api/session-history?limit=3");
    const byCode = await api(`/api/join-codes/${encodeURIComponent(paddedJoinCode)}`);
    const qr = await fetch(`${baseUrl}/api/qr?data=${encodeURIComponent(`${baseUrl}/trivia/session/${created.joinCode}`)}`);
    const qrSvg = await qr.text();
    const limitedQr = await fetch(`${baseUrl}/api/qr?data=${encodeURIComponent(`${baseUrl}/trivia/session/${created.joinCode}`)}`);
    const displayRoute = await fetch(`${baseUrl}/trivia/display/${created.sessionId}`);
    const displayHtml = await displayRoute.text();

    assert.equal(player.session.winner.playerId, joined.playerId);
    assert.equal(player.player.currentAnswer.choiceId, correct.id);
    assert.equal(created.snapshot.session.id, created.sessionId);
    assert.equal(joined.snapshot.player.id, joined.playerId);
    assert.equal(started.snapshot.session.status, "QUESTION_ACTIVE");
    assert.equal(rejoined.playerId, joined.playerId);
    assert.equal(rejoined.reconnected, true);
    assert.equal(rejoined.snapshot.session.playerCount, 1);
    assert.equal(couplesSession.snapshot.session.winnerRule.type, "COUPLES_MATCH");
    assert.equal(couplePlayer.snapshot.player.progress.pairCode, "Table 4");
    assert.equal(couplePlayer.snapshot.coupleStandings[0].pairCode, "Table 4");
    assert.equal(couplePlayer.snapshot.coupleStandings[0].ready, false);
    assert.equal(accepted.snapshot.player.currentAnswer.choiceId, correct.id);
    assert.equal(health.ok, true);
    assert.equal(health.store, "json");
    assert.equal(clientConfig.realtime, false);
    assert.equal(unauthorizedCreate.status, 401);
    assert.equal(unauthorizedQuestions.status, 401);
    assert.equal(unauthorizedHistory.status, 401);
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
    assert.equal(unauthorizedOperator.status, 401);
    assert.equal(unauthorizedOperatorSnapshot.status, 401);
    assert.equal(history.sessions[0].sessionId, created.sessionId);
    assert.equal(history.sessions[0].winner.displayName, "API Player");
    assert.equal(history.sessions[0].answerCount, 1);
    assert.equal(questions.questions.some((question) => question.id === savedQuestion.question.id), true);
    assert.equal(archivedQuestion.question.archived, true);
    assert.equal(byCode.sessionId, created.sessionId);
    assert.equal(qr.status, 200);
    assert.match(qrSvg, /<svg/);
    assert.equal(limitedQr.status, 429);
    assert.ok(Number(limitedQr.headers.get("retry-after")) > 0);
    assert.ok(Number(limitedQr.headers.get("retry-after")) <= 60);
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
