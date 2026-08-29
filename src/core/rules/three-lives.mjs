import { PlayerStatus } from "../types.mjs";
import { activePlayers, positiveInt, progressFor } from "./shared.mjs";

export const threeLivesRule = {
  type: "THREE_LIVES",
  label: "Three Lives",
  defaults: { startingLives: 3, simultaneousEliminationPolicy: "NO_WINNER_UNTIL_ONE_REMAINS" },
  configure(input = {}) {
    return {
      type: this.type,
      startingLives: positiveInt(input.startingLives, this.defaults.startingLives),
      simultaneousEliminationPolicy: input.simultaneousEliminationPolicy || this.defaults.simultaneousEliminationPolicy
    };
  },
  initializePlayer(player, config) {
    player.lives = config.startingLives;
  },
  applyAnswer({ player, answer }) {
    if (answer.isCorrect) {
      player.correctCount += 1;
      player.streak += 1;
      player.points += 100;
      return;
    }
    player.incorrectCount += 1;
    player.streak = 0;
    player.lives = Math.max(0, player.lives - 1);
    if (player.lives === 0) player.status = PlayerStatus.ELIMINATED;
  },
  evaluate({ session }) {
    const remaining = activePlayers(session);
    if (remaining.length !== 1 || session.players.size < 2) return null;
    const winner = remaining[0];
    return {
      playerId: winner.id,
      ruleType: this.type,
      reason: "Last player with lives remaining",
      metadata: { startingLives: session.configurationSnapshot.winnerRule.startingLives }
    };
  },
  progress(player, config) {
    return progressFor(player, this, { startingLives: config.startingLives });
  }
};
