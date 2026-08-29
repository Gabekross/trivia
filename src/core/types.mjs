export const SessionStatus = Object.freeze({
  LOBBY: "LOBBY",
  QUESTION_ACTIVE: "QUESTION_ACTIVE",
  QUESTION_LOCKED: "QUESTION_LOCKED",
  ANSWER_REVEAL: "ANSWER_REVEAL",
  LEADERBOARD: "LEADERBOARD",
  WINNER_FOUND: "WINNER_FOUND",
  PAUSED: "PAUSED",
  ENDED: "ENDED"
});

export const PlayerStatus = Object.freeze({
  ACTIVE: "ACTIVE",
  WINNER: "WINNER",
  SPECTATOR: "SPECTATOR",
  DISCONNECTED: "DISCONNECTED"
});

export const Role = Object.freeze({
  OPERATOR: "OPERATOR",
  PLAYER: "PLAYER",
  DISPLAY: "DISPLAY"
});

export function nowIso(clock = Date) {
  return new clock().toISOString();
}

export function makeId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function sanitizeDisplayName(value) {
  return String(value || "Player")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32) || "Player";
}
