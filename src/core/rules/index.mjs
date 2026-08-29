import { highestScoreRule } from "./highest-score.mjs";
import { hotStreakRule } from "./hot-streak.mjs";
import { lastPlayerStandingRule } from "./last-player-standing.mjs";
import { raceToXRule } from "./race-to-x.mjs";
import { threeLivesRule } from "./three-lives.mjs";
import { tournamentRule } from "./tournament.mjs";

export const rules = [raceToXRule, hotStreakRule, threeLivesRule, lastPlayerStandingRule, highestScoreRule, tournamentRule];
export const ruleRegistry = new Map(rules.map((rule) => [rule.type, rule]));

export function getRule(type) {
  const rule = ruleRegistry.get(type || raceToXRule.type);
  if (!rule) throw new Error(`Unsupported winner rule: ${type}`);
  return rule;
}

export function configureWinnerRule(input = {}) {
  const type = input.type || input.winnerMode || raceToXRule.type;
  return getRule(type).configure(input);
}

export function ruleOptions() {
  return rules.map((rule) => ({ type: rule.type, label: rule.label, defaults: rule.defaults }));
}
