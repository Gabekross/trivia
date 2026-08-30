import assert from "node:assert/strict";
import test from "node:test";
import { TriviaEngine } from "../src/core/trivia-engine.mjs";
import { getRule, ruleOptions } from "../src/core/rules/index.mjs";
import { PlayerStatus } from "../src/core/types.mjs";

test("rule registry exposes Phase 2 launch modes", () => {
  assert.deepEqual(
    ruleOptions().map((rule) => rule.type),
    ["RACE_TO_X", "HOT_STREAK", "THREE_LIVES", "LAST_PLAYER_STANDING", "HIGHEST_SCORE", "TOURNAMENT", "COUPLES_MATCH"]
  );
});

test("Race-to-X deterministic tie policy uses accepted time then join order", () => {
  const engine = new TriviaEngine();
  const session = engine.createSession({ targetCorrect: 2 });
  const first = engine.joinSession(session.joinCode, "First");
  const second = engine.joinSession(session.joinCode, "Second");
  engine.operatorAction(session.id, "START");

  first.correctCount = 2;
  second.correctCount = 2;
  session.answers.set(`${session.currentQuestionId}:${first.id}`, {
    acceptedAt: "2026-08-27T12:00:00.000Z",
    responseMs: 500,
    isCorrect: true
  });
  session.answers.set(`${session.currentQuestionId}:${second.id}`, {
    acceptedAt: "2026-08-27T12:00:00.000Z",
    responseMs: 500,
    isCorrect: true
  });

  const winner = getRule("RACE_TO_X").evaluate({ session, questionId: session.currentQuestionId, answeredPlayerIds: [second.id, first.id] });
  assert.equal(winner.playerId, first.id);
});

test("Hot Streak wins at configured streak threshold", () => {
  const engine = new TriviaEngine();
  const session = engine.createSession({ winnerMode: "HOT_STREAK", requiredStreak: 2 });
  const player = engine.joinSession(session.joinCode, "Streaker");

  answerCorrect(engine, session, player);
  engine.operatorAction(session.id, "REVEAL");
  engine.operatorAction(session.id, "SHOW_LEADERBOARD");
  engine.operatorAction(session.id, "NEXT_QUESTION");
  answerCorrect(engine, session, player);

  assert.equal(session.winners[0].playerId, player.id);
  assert.equal(session.winners[0].ruleType, "HOT_STREAK");
});

test("Three Lives eliminates wrong answers and wins when one player remains", () => {
  const engine = new TriviaEngine();
  const session = engine.createSession({ winnerMode: "THREE_LIVES", startingLives: 1 });
  const survivor = engine.joinSession(session.joinCode, "Survivor");
  const eliminated = engine.joinSession(session.joinCode, "Out");
  engine.operatorAction(session.id, "START");
  const wrongChoice = activeQuestion(engine, session).choices.find((choice) => !choice.isCorrect);

  engine.submitAnswer({ sessionId: session.id, playerId: survivor.id, choiceId: correctChoice(engine, session).id });
  engine.submitAnswer({ sessionId: session.id, playerId: eliminated.id, choiceId: wrongChoice.id });

  assert.equal(eliminated.status, PlayerStatus.ELIMINATED);
  assert.equal(session.winners[0].playerId, survivor.id);
  assert.equal(session.winners[0].ruleType, "THREE_LIVES");
});

test("Last Player Standing eliminates immediately on wrong answer", () => {
  const engine = new TriviaEngine();
  const session = engine.createSession({ winnerMode: "LAST_PLAYER_STANDING" });
  const survivor = engine.joinSession(session.joinCode, "Still Here");
  const eliminated = engine.joinSession(session.joinCode, "Miss");
  engine.operatorAction(session.id, "START");
  const wrongChoice = activeQuestion(engine, session).choices.find((choice) => !choice.isCorrect);

  engine.submitAnswer({ sessionId: session.id, playerId: survivor.id, choiceId: correctChoice(engine, session).id });
  engine.submitAnswer({ sessionId: session.id, playerId: eliminated.id, choiceId: wrongChoice.id });

  assert.equal(eliminated.status, PlayerStatus.ELIMINATED);
  assert.equal(session.winners[0].ruleType, "LAST_PLAYER_STANDING");
});

test("Highest Score waits for question limit and all answers", () => {
  const engine = new TriviaEngine();
  const session = engine.createSession({ winnerMode: "HIGHEST_SCORE", questionLimit: 1 });
  const winner = engine.joinSession(session.joinCode, "High");
  const other = engine.joinSession(session.joinCode, "Low");
  engine.operatorAction(session.id, "START");
  const wrongChoice = activeQuestion(engine, session).choices.find((choice) => !choice.isCorrect);

  engine.submitAnswer({ sessionId: session.id, playerId: winner.id, choiceId: correctChoice(engine, session).id });
  assert.equal(session.winners.length, 0);
  engine.submitAnswer({ sessionId: session.id, playerId: other.id, choiceId: wrongChoice.id });

  assert.equal(session.winners[0].playerId, winner.id);
  assert.equal(session.winners[0].ruleType, "HIGHEST_SCORE");
});

test("Tournament records advancing players at configured cutoff", () => {
  const engine = new TriviaEngine();
  const session = engine.createSession({ winnerMode: "TOURNAMENT", questionLimit: 1, advanceCount: 2 });
  const one = engine.joinSession(session.joinCode, "One");
  const two = engine.joinSession(session.joinCode, "Two");
  const three = engine.joinSession(session.joinCode, "Three");
  engine.operatorAction(session.id, "START");
  const wrongChoice = activeQuestion(engine, session).choices.find((choice) => !choice.isCorrect);

  engine.submitAnswer({ sessionId: session.id, playerId: one.id, choiceId: correctChoice(engine, session).id });
  engine.submitAnswer({ sessionId: session.id, playerId: two.id, choiceId: correctChoice(engine, session).id });
  engine.submitAnswer({ sessionId: session.id, playerId: three.id, choiceId: wrongChoice.id });

  assert.equal(session.winners[0].ruleType, "TOURNAMENT");
  assert.deepEqual(session.winners[0].metadata.advancingPlayerIds, [one.id, two.id]);
  assert.equal(three.status, PlayerStatus.SPECTATOR);
});

test("Couples Match scores only when both partners answer correctly", () => {
  const engine = new TriviaEngine();
  const session = engine.createSession({ winnerMode: "COUPLES_MATCH", targetCoupleMatches: 1 });
  const firstPartner = engine.joinSession(session.joinCode, "First Partner", { pairCode: "Team A" });
  const secondPartner = engine.joinSession(session.joinCode, "Second Partner", { pairCode: "Team A" });
  const solo = engine.joinSession(session.joinCode, "Solo", { pairCode: "Solo" });
  engine.operatorAction(session.id, "START");
  const wrongChoice = activeQuestion(engine, session).choices.find((choice) => !choice.isCorrect);

  engine.submitAnswer({ sessionId: session.id, playerId: firstPartner.id, choiceId: correctChoice(engine, session).id });
  assert.equal(session.winners.length, 0);
  engine.submitAnswer({ sessionId: session.id, playerId: solo.id, choiceId: correctChoice(engine, session).id });
  assert.equal(session.winners.length, 0);
  engine.submitAnswer({ sessionId: session.id, playerId: secondPartner.id, choiceId: wrongChoice.id });
  assert.equal(session.winners.length, 0);

  engine.operatorAction(session.id, "REVEAL");
  engine.operatorAction(session.id, "SHOW_LEADERBOARD");
  engine.operatorAction(session.id, "NEXT_QUESTION");
  engine.submitAnswer({ sessionId: session.id, playerId: firstPartner.id, choiceId: correctChoice(engine, session).id });
  engine.submitAnswer({ sessionId: session.id, playerId: secondPartner.id, choiceId: correctChoice(engine, session).id });

  assert.equal(session.winners[0].ruleType, "COUPLES_MATCH");
  assert.deepEqual(session.winners[0].metadata.partnerPlayerIds, [firstPartner.id, secondPartner.id]);
  assert.equal(session.winners[0].metadata.coupleScore, 1);
  const snapshot = engine.snapshot(session.id, "PLAYER", firstPartner.id);
  assert.equal(snapshot.player.progress.coupleScore, 1);
  assert.deepEqual(snapshot.coupleStandings[0].memberIds, [firstPartner.id, secondPartner.id]);
  assert.equal(snapshot.coupleStandings[0].score, 1);
  assert.equal(snapshot.coupleStandings[0].ready, true);
});

function activeQuestion(engine, session) {
  return engine.snapshot(session.id, "OPERATOR").question;
}

function correctChoice(engine, session) {
  return activeQuestion(engine, session).choices.find((choice) => choice.isCorrect);
}

function answerCorrect(engine, session, player) {
  if (session.currentQuestionId === null) engine.operatorAction(session.id, "START");
  engine.submitAnswer({ sessionId: session.id, playerId: player.id, choiceId: correctChoice(engine, session).id });
}
