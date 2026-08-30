import { answerFor, positiveInt, progressFor } from "./shared.mjs";

export const couplesMatchRule = {
  type: "COUPLES_MATCH",
  label: "Couples Match",
  defaults: { targetCoupleMatches: 3 },
  configure(input = {}) {
    return {
      type: this.type,
      targetCoupleMatches: positiveInt(input.targetCoupleMatches, this.defaults.targetCoupleMatches)
    };
  },
  initializePlayer(player) {
    player.pairCode ||= null;
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
    const player = session.players.get(answeredPlayerIds?.[0]);
    const pairCode = player?.pairCode;
    if (!pairCode) return null;
    const pair = [...session.players.values()].filter((item) => item.pairCode === pairCode);
    if (pair.length < 2) return null;
    const answers = pair.map((item) => answerFor(session, questionId, item.id));
    if (answers.some((answer) => !answer)) return null;
    if (answers.some((answer) => !answer.isCorrect)) return null;

    session.coupleQuestionAwards ||= {};
    session.coupleScores ||= {};
    const awardKey = `${questionId}:${pairCode}`;
    if (!session.coupleQuestionAwards[awardKey]) {
      session.coupleQuestionAwards[awardKey] = true;
      session.coupleScores[pairCode] = (session.coupleScores[pairCode] || 0) + 1;
    }

    const score = session.coupleScores[pairCode] || 0;
    if (score < session.configurationSnapshot.winnerRule.targetCoupleMatches) return null;
    return {
      playerId: pair[0].id,
      ruleType: this.type,
      reason: `Couple reached ${session.configurationSnapshot.winnerRule.targetCoupleMatches} matched correct answers`,
      metadata: { pairCode, partnerPlayerIds: pair.map((item) => item.id), coupleScore: score }
    };
  },
  progress(player, config, session = null) {
    const coupleScore = session && player.pairCode ? session.coupleScores?.[player.pairCode] || 0 : 0;
    return progressFor(player, this, {
      pairCode: player.pairCode,
      coupleScore,
      targetCoupleMatches: config.targetCoupleMatches
    });
  }
};
