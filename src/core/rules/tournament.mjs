import { PlayerStatus } from "../types.mjs";
import { allPlayersAnswered, positiveInt, progressFor } from "./shared.mjs";

export const tournamentRule = {
  type: "TOURNAMENT",
  label: "Tournament",
  defaults: { questionLimit: 3, advanceCount: 3, finalMode: "HIGHEST_SCORE" },
  configure(input = {}) {
    return {
      type: this.type,
      questionLimit: positiveInt(input.questionLimit, this.defaults.questionLimit),
      advanceCount: positiveInt(input.advanceCount, this.defaults.advanceCount),
      finalMode: input.finalMode || this.defaults.finalMode
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
  evaluate({ session, questionId }) {
    const config = session.configurationSnapshot.winnerRule;
    const reachedLimit = session.currentQuestionIndex + 1 >= config.questionLimit;
    if (!reachedLimit || !allPlayersAnswered(session, questionId)) return null;
    const ranked = [...session.players.values()].sort((a, b) => b.points - a.points || b.correctCount - a.correctCount || a.joinOrder - b.joinOrder);
    const advancing = ranked.slice(0, config.advanceCount);
    for (const player of ranked.slice(config.advanceCount)) player.status = PlayerStatus.SPECTATOR;
    return {
      playerId: advancing[0].id,
      ruleType: this.type,
      reason: `Top ${config.advanceCount} qualification complete`,
      metadata: { advanceCount: config.advanceCount, advancingPlayerIds: advancing.map((player) => player.id), finalMode: config.finalMode }
    };
  },
  progress(player, config) {
    return progressFor(player, this, { questionLimit: config.questionLimit, advanceCount: config.advanceCount });
  }
};
