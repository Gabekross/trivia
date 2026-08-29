import assert from "node:assert/strict";
import test from "node:test";
import { canTransition, allowedActions } from "../src/core/state-machine.mjs";
import { SessionStatus } from "../src/core/types.mjs";

test("state machine permits normal lobby to active flow", () => {
  assert.equal(canTransition(SessionStatus.LOBBY, SessionStatus.QUESTION_ACTIVE), true);
  assert.equal(canTransition(SessionStatus.LOBBY, SessionStatus.ANSWER_REVEAL), false);
});

test("ended sessions are terminal", () => {
  assert.equal(canTransition(SessionStatus.ENDED, SessionStatus.LOBBY), false);
  assert.equal(allowedActions(SessionStatus.ENDED).canEnd, false);
});
