import { fastestByAnswer, positiveInt, progressFor } from "./shared.mjs";

export const hotStreakRule = {
  type: "HOT_STREAK",
  label: "Hot Streak",
  defaults: { requiredStreak: 3, tiePolicy: "FASTEST_SERVER_ACCEPTED" },
  configure(input = {}) {
    return {
      type: this.type,
      requiredStreak: positiveInt(input.requiredStreak ?? input.targetCorrect, this.defaults.requiredStreak),
      tiePolicy: input.tiePolicy || this.defaults.tiePolicy
    };
  },
  applyAnswer({ player, answer }) {
    if (answer.isCorrect) {
      player.correctCount += 1;
      player.streak += 1;
      player.points += 100 + Math.max(0, player.streak - 1) * 25;
    } else {
      player.incorrectCount += 1;
      player.streak = 0;
    }
  },
  evaluate({ session, questionId, answeredPlayerIds }) {
    const requiredStreak = session.configurationSnapshot.winnerRule.requiredStreak;
    const candidates = answeredPlayerIds
      .map((playerId) => session.players.get(playerId))
      .filter((player) => player && player.streak >= requiredStreak);

    if (candidates.length === 0) return null;
    const winner = fastestByAnswer(session, questionId, candidates)[0];
    return {
      playerId: winner.id,
      ruleType: this.type,
      reason: `First to a ${requiredStreak}-answer hot streak`,
      metadata: { requiredStreak, tiePolicy: "FASTEST_SERVER_ACCEPTED" }
    };
  },
  progress(player, config) {
    return progressFor(player, this, { requiredStreak: config.requiredStreak });
  }
};
