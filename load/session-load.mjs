import { performance } from "node:perf_hooks";
import { TriviaEngine } from "../src/core/trivia-engine.mjs";
import { Role } from "../src/core/types.mjs";

const sizes = [50, 100, 200];

for (const size of sizes) {
  const engine = new TriviaEngine();
  const session = engine.createSession({ title: `Load ${size}`, targetCorrect: 999, maxPlayers: 200 });
  const players = [];
  const startJoin = performance.now();
  for (let index = 0; index < size; index += 1) {
    players.push(engine.joinSession(session.joinCode, `Player ${index + 1}`));
  }
  const joinMs = performance.now() - startJoin;

  engine.operatorAction(session.id, "START");
  const question = engine.snapshot(session.id, Role.OPERATOR).question;
  const choices = question.choices.map((choice) => choice.id);
  const startAnswer = performance.now();
  for (let index = 0; index < players.length; index += 1) {
    engine.submitAnswer({
      sessionId: session.id,
      playerId: players[index].id,
      choiceId: choices[index % choices.length],
      idempotencyKey: `${size}-${index}`
    });
  }
  const answerMs = performance.now() - startAnswer;

  const snapshot = engine.snapshot(session.id, Role.DISPLAY);
  console.log(`${size} players: join=${joinMs.toFixed(2)}ms answers=${answerMs.toFixed(2)}ms accepted=${snapshot.answerCount}`);
}
