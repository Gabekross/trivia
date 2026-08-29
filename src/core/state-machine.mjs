import { SessionStatus } from "./types.mjs";

const transitions = {
  [SessionStatus.LOBBY]: new Set([SessionStatus.QUESTION_ACTIVE, SessionStatus.PAUSED, SessionStatus.ENDED]),
  [SessionStatus.QUESTION_ACTIVE]: new Set([SessionStatus.QUESTION_LOCKED, SessionStatus.ANSWER_REVEAL, SessionStatus.WINNER_FOUND, SessionStatus.PAUSED, SessionStatus.LOBBY, SessionStatus.ENDED]),
  [SessionStatus.QUESTION_LOCKED]: new Set([SessionStatus.ANSWER_REVEAL, SessionStatus.PAUSED, SessionStatus.LOBBY, SessionStatus.ENDED]),
  [SessionStatus.ANSWER_REVEAL]: new Set([SessionStatus.LEADERBOARD, SessionStatus.QUESTION_ACTIVE, SessionStatus.WINNER_FOUND, SessionStatus.PAUSED, SessionStatus.LOBBY, SessionStatus.ENDED]),
  [SessionStatus.LEADERBOARD]: new Set([SessionStatus.QUESTION_ACTIVE, SessionStatus.PAUSED, SessionStatus.LOBBY, SessionStatus.ENDED]),
  [SessionStatus.WINNER_FOUND]: new Set([SessionStatus.PAUSED, SessionStatus.QUESTION_ACTIVE, SessionStatus.LOBBY, SessionStatus.ENDED]),
  [SessionStatus.PAUSED]: new Set([SessionStatus.QUESTION_ACTIVE, SessionStatus.LOBBY, SessionStatus.ENDED]),
  [SessionStatus.ENDED]: new Set([])
};

export function canTransition(from, to) {
  return Boolean(transitions[from]?.has(to));
}

export function assertTransition(from, to) {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid session transition: ${from} -> ${to}`);
  }
}

export function allowedActions(status) {
  return {
    canStart: status === SessionStatus.LOBBY,
    canClose: status === SessionStatus.QUESTION_ACTIVE,
    canReveal: status === SessionStatus.QUESTION_ACTIVE || status === SessionStatus.QUESTION_LOCKED,
    canNext: status === SessionStatus.ANSWER_REVEAL || status === SessionStatus.LEADERBOARD || status === SessionStatus.PAUSED,
    canPause: status !== SessionStatus.ENDED && status !== SessionStatus.PAUSED,
    canResume: status === SessionStatus.PAUSED || status === SessionStatus.WINNER_FOUND,
    canReset: status !== SessionStatus.ENDED,
    canEnd: status !== SessionStatus.ENDED
  };
}
