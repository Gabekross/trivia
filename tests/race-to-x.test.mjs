import assert from "node:assert/strict";
import test from "node:test";
import { TriviaEngine } from "../src/core/trivia-engine.mjs";
import { Role, SessionStatus } from "../src/core/types.mjs";

test("player payload hides correct answers during active question", () => {
  const engine = new TriviaEngine();
  const session = engine.createSession({ targetCorrect: 1 });
  const player = engine.joinSession(session.joinCode, "Avery");
  engine.operatorAction(session.id, "START");

  const snapshot = engine.snapshot(session.id, Role.PLAYER, player.id);
  assert.equal(snapshot.session.status, SessionStatus.QUESTION_ACTIVE);
  assert.equal(snapshot.question.choices.some((choice) => choice.isCorrect === true), false);
});

test("player sees wrong answer feedback only after reveal", () => {
  const engine = new TriviaEngine();
  const session = engine.createSession({ targetCorrect: 3 });
  const player = engine.joinSession(session.joinCode, "Avery");
  engine.operatorAction(session.id, "START");
  const operator = engine.snapshot(session.id, Role.OPERATOR);
  const wrongChoice = operator.question.choices.find((choice) => !choice.isCorrect);

  engine.submitAnswer({ sessionId: session.id, playerId: player.id, choiceId: wrongChoice.id, idempotencyKey: "wrong-feedback" });
  const activeSnapshot = engine.snapshot(session.id, Role.PLAYER, player.id);

  assert.equal(activeSnapshot.session.status, SessionStatus.QUESTION_ACTIVE);
  assert.equal(activeSnapshot.player.currentAnswer.choiceId, wrongChoice.id);
  assert.equal(activeSnapshot.player.currentAnswer.isCorrect, undefined);
  assert.equal(activeSnapshot.question.choices.some((choice) => choice.isCorrect === true), false);

  engine.operatorAction(session.id, "REVEAL");
  const revealSnapshot = engine.snapshot(session.id, Role.PLAYER, player.id);
  assert.equal(revealSnapshot.player.currentAnswer.isCorrect, false);
  assert.equal(revealSnapshot.question.choices.some((choice) => choice.isCorrect === true), true);
});

test("operator payload can see answer key", () => {
  const engine = new TriviaEngine();
  const session = engine.createSession({ targetCorrect: 1 });
  engine.operatorAction(session.id, "START");

  const snapshot = engine.snapshot(session.id, Role.OPERATOR);
  assert.equal(snapshot.question.choices.filter((choice) => choice.isCorrect).length, 1);
});

test("one answer is accepted per player per question", () => {
  const engine = new TriviaEngine();
  const session = engine.createSession({ targetCorrect: 3 });
  const player = engine.joinSession(session.joinCode, "Blake");
  engine.operatorAction(session.id, "START");
  const question = engine.snapshot(session.id, Role.OPERATOR).question;

  const first = engine.submitAnswer({ sessionId: session.id, playerId: player.id, choiceId: question.choices[0].id, idempotencyKey: "same-player" });
  const second = engine.submitAnswer({ sessionId: session.id, playerId: player.id, choiceId: question.choices[1].id, idempotencyKey: "same-player-2" });

  assert.equal(first.choiceId, second.choiceId);
  assert.equal([...session.answers.values()].length, 1);
});

test("idempotency key returns the original accepted answer", () => {
  const engine = new TriviaEngine();
  const session = engine.createSession({ targetCorrect: 3 });
  const player = engine.joinSession(session.joinCode, "Casey");
  engine.operatorAction(session.id, "START");
  const question = engine.snapshot(session.id, Role.OPERATOR).question;

  const first = engine.submitAnswer({ sessionId: session.id, playerId: player.id, choiceId: question.choices[0].id, idempotencyKey: "retry-key" });
  const retry = engine.submitAnswer({ sessionId: session.id, playerId: player.id, choiceId: question.choices[1].id, idempotencyKey: "retry-key" });

  assert.equal(retry, first);
  assert.equal(retry.choiceId, question.choices[0].id);
});

test("Race-to-X chooses the fastest newly qualifying player and pauses on winner", () => {
  class FakeClock extends Date {
    constructor() {
      super(FakeClock.next());
    }
    static next() {
      FakeClock.t += 5;
      return FakeClock.t;
    }
  }
  FakeClock.t = Date.parse("2026-08-25T12:00:00Z");

  const engine = new TriviaEngine({ clock: FakeClock });
  const session = engine.createSession({ targetCorrect: 1 });
  const slow = engine.joinSession(session.joinCode, "Slow");
  const fast = engine.joinSession(session.joinCode, "Fast");
  engine.operatorAction(session.id, "START");
  const question = engine.snapshot(session.id, Role.OPERATOR).question;
  const correctChoice = question.choices.find((choice) => choice.isCorrect);

  engine.submitAnswer({ sessionId: session.id, playerId: fast.id, choiceId: correctChoice.id, idempotencyKey: "fast" });
  assert.equal(session.status, SessionStatus.WINNER_FOUND);
  assert.equal(session.winners[0].playerId, fast.id);

  assert.throws(() => engine.submitAnswer({ sessionId: session.id, playerId: slow.id, choiceId: correctChoice.id, idempotencyKey: "slow" }), /not accepting/);
  engine.operatorAction(session.id, "ACK_WINNER");
  assert.equal(session.status, SessionStatus.PAUSED);
});

test("invalid operator state transition is rejected", () => {
  const engine = new TriviaEngine();
  const session = engine.createSession();
  assert.throws(() => engine.operatorAction(session.id, "REVEAL"), /Invalid session transition/);
});

test("auto reveal advances active question after configured seconds", () => {
  class ManualClock extends Date {
    constructor() {
      super(ManualClock.now);
    }
  }
  ManualClock.now = Date.parse("2026-08-25T12:00:00Z");

  const engine = new TriviaEngine({ clock: ManualClock });
  const session = engine.createSession({ autoReveal: true, questionSeconds: 2 });
  engine.operatorAction(session.id, "START");

  ManualClock.now += 3000;
  const advanced = engine.advanceTimers(session.id);

  assert.equal(advanced.status, SessionStatus.ANSWER_REVEAL);
});

test("auto advance starts next question after configured reveal seconds", () => {
  class ManualClock extends Date {
    constructor() {
      super(ManualClock.now);
    }
  }
  ManualClock.now = Date.parse("2026-08-25T12:00:00Z");

  const engine = new TriviaEngine({ clock: ManualClock });
  const session = engine.createSession({ autoAdvanceAfterReveal: true, revealSeconds: 2 });
  engine.operatorAction(session.id, "START");
  engine.operatorAction(session.id, "REVEAL");

  ManualClock.now += 3000;
  const advanced = engine.advanceTimers(session.id);

  assert.equal(advanced.status, SessionStatus.QUESTION_ACTIVE);
  assert.equal(advanced.currentQuestionIndex, 1);
});
