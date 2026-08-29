import { fastestByAnswer, positiveInt, progressFor } from "./shared.mjs";

export const raceToXRule = {
  type: "RACE_TO_X",
  label: "Race to X",
  defaults: { targetCorrect: 2, tiePolicy: "FASTEST_SERVER_ACCEPTED" },
  configure(input = {}) {
    return {
      type: this.type,
      targetCorrect: positiveInt(input.targetCorrect ?? input.threshold, this.defaults.targetCorrect),
      tiePolicy: input.tiePolicy || this.defaults.tiePolicy
    };
  },
  applyAnswer({ player, answer }) {
    if (answer.isCorrect) {
      player.correctCount += 1;
      player.streak += 1;
      player.points += 100;
    } else {
      player.incorrectCount += 1;
      player.streak = 0;
    }
  },
  evaluate({ session, questionId, answeredPlayerIds }) {
    const target = session.configurationSnapshot.winnerRule.targetCorrect;
    const candidates = answeredPlayerIds
      .map((playerId) => session.players.get(playerId))
      .filter((player) => player && player.correctCount >= target);

    if (candidates.length === 0) return null;
    const winner = fastestByAnswer(session, questionId, candidates)[0];
    return {
      playerId: winner.id,
      ruleType: this.type,
      reason: `First to ${target} correct answers`,
      metadata: { targetCorrect: target, tiePolicy: "FASTEST_SERVER_ACCEPTED" }
    };
  },
  progress(player, config) {
    return progressFor(player, this, { targetCorrect: config.targetCorrect });
  }
};
