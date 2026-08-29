import { PlayerStatus } from "../types.mjs";

export function answerFor(session, questionId, playerId) {
  return session.answers.get(`${questionId}:${playerId}`);
}

export function fastestByAnswer(session, questionId, players) {
  return [...players].sort((a, b) => {
    const answerA = answerFor(session, questionId, a.id);
    const answerB = answerFor(session, questionId, b.id);
    const timeDelta = new Date(answerA.acceptedAt).getTime() - new Date(answerB.acceptedAt).getTime();
    if (timeDelta !== 0) return timeDelta;
    const responseDelta = answerA.responseMs - answerB.responseMs;
    if (responseDelta !== 0) return responseDelta;
    return a.joinOrder - b.joinOrder;
  });
}

export function activePlayers(session) {
  return [...session.players.values()].filter((player) => player.status === PlayerStatus.ACTIVE);
}

export function allPlayersAnswered(session, questionId) {
  return [...session.players.values()].every((player) => session.answers.has(`${questionId}:${player.id}`));
}

export function progressFor(player, rule, extra = {}) {
  return {
    ruleType: rule.type,
    correctCount: player.correctCount,
    incorrectCount: player.incorrectCount,
    streak: player.streak,
    lives: player.lives,
    points: player.points,
    status: player.status,
    ...extra
  };
}

export function positiveInt(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}
