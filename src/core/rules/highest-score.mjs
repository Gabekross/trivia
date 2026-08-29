import { allPlayersAnswered, fastestByAnswer, positiveInt, progressFor } from "./shared.mjs";

export const highestScoreRule = {
  type: "HIGHEST_SCORE",
  label: "Highest Score",
  defaults: { questionLimit: 3, pointsPerCorrect: 100, speedBonus: 0, tieBreaker: "FASTEST_LAST_CORRECT" },
  configure(input = {}) {
    return {
      type: this.type,
      questionLimit: positiveInt(input.questionLimit, this.defaults.questionLimit),
      pointsPerCorrect: positiveInt(input.pointsPerCorrect, this.defaults.pointsPerCorrect),
      speedBonus: Math.max(0, Number(input.speedBonus ?? this.defaults.speedBonus)),
      tieBreaker: input.tieBreaker || this.defaults.tieBreaker
    };
  },
  applyAnswer({ player, answer, config }) {
    if (answer.isCorrect) {
      player.correctCount += 1;
      player.streak += 1;
      player.points += config.pointsPerCorrect + Math.max(0, config.speedBonus - Math.floor(answer.responseMs / 1000));
    } else {
      player.incorrectCount += 1;
      player.streak = 0;
    }
  },
  evaluate({ session, questionId }) {
    const config = session.configurationSnapshot.winnerRule;
    const reachedLimit = session.currentQuestionIndex + 1 >= config.questionLimit;
    if (!reachedLimit || !allPlayersAnswered(session, questionId)) return null;
    const players = [...session.players.values()];
    const highScore = Math.max(...players.map((player) => player.points));
    const candidates = players.filter((player) => player.points === highScore);
    const winner = candidates.length === 1 ? candidates[0] : fastestByAnswer(session, questionId, candidates)[0];
    return {
      playerId: winner.id,
      ruleType: this.type,
      reason: `Highest score after ${config.questionLimit} questions`,
      metadata: { questionLimit: config.questionLimit, points: winner.points, tieBreaker: config.tieBreaker }
    };
  },
  progress(player, config) {
    return progressFor(player, this, { questionLimit: config.questionLimit });
  }
};
