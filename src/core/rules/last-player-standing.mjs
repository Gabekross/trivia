import { PlayerStatus } from "../types.mjs";
import { activePlayers, progressFor } from "./shared.mjs";

export const lastPlayerStandingRule = {
  type: "LAST_PLAYER_STANDING",
  label: "Last Player Standing",
  defaults: { revivePolicy: "NONE", allWrongPolicy: "NO_WINNER" },
  configure(input = {}) {
    return {
      type: this.type,
      revivePolicy: input.revivePolicy || this.defaults.revivePolicy,
      allWrongPolicy: input.allWrongPolicy || this.defaults.allWrongPolicy
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
      player.status = PlayerStatus.ELIMINATED;
    }
  },
  evaluate({ session }) {
    const remaining = activePlayers(session);
    if (remaining.length !== 1 || session.players.size < 2) return null;
    const winner = remaining[0];
    return {
      playerId: winner.id,
      ruleType: this.type,
      reason: "Only active player remaining",
      metadata: { revivePolicy: "NONE", allWrongPolicy: "NO_WINNER" }
    };
  },
  progress(player) {
    return progressFor(player, this);
  }
};
