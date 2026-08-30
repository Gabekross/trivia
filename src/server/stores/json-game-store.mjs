import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { TriviaEngine } from "../../core/trivia-engine.mjs";
import { GameStore } from "./game-store.mjs";

export class JsonGameStore extends GameStore {
  constructor({ statePath, defaultSessionConfig = {}, engine = new TriviaEngine() }) {
    super();
    this.statePath = statePath;
    this.defaultSessionConfig = defaultSessionConfig;
    this.engine = engine;
    this.ready = this.load();
  }

  async bootstrap() {
    await this.ready;
    let session = [...this.engine.sessions.values()].at(-1);
    if (!session) {
      session = this.engine.createSession(this.defaultSessionConfig);
      await this.persist();
    }
    return { sessionId: session.id, joinCode: session.joinCode };
  }

  async createSession(config = {}) {
    await this.ready;
    const session = this.engine.createSession(config);
    await this.persist();
    return { sessionId: session.id, joinCode: session.joinCode, session };
  }

  async findSessionByJoinCode(joinCode) {
    await this.ready;
    const session = this.engine.findSessionByJoinCode(joinCode);
    return session ? { sessionId: session.id, joinCode: session.joinCode, session } : null;
  }

  async getSnapshot(sessionId, role, playerId = null) {
    await this.ready;
    return this.engine.snapshot(sessionId, role, playerId);
  }

  async listQuestions() {
    await this.ready;
    return this.engine.listQuestions();
  }

  async saveQuestion(question) {
    await this.ready;
    const saved = question.id ? this.engine.updateQuestion(question.id, question) : this.engine.addQuestion(question);
    await this.persist();
    return saved;
  }

  async archiveQuestion(questionId) {
    await this.ready;
    const question = this.engine.archiveQuestion(questionId);
    await this.persist();
    return question;
  }

  async advanceTimers(sessionId) {
    await this.ready;
    const session = this.engine.advanceTimers(sessionId);
    if (!session) return { sessionId, advanced: false, eventType: null };
    const eventType = session.auditLog.at(-1)?.eventType || "SESSION_UPDATED";
    await this.persist();
    return { sessionId, advanced: true, eventType, session };
  }

  async joinSession(joinCode, displayName) {
    await this.ready;
    const player = this.engine.joinSession(joinCode, displayName);
    const session = this.engine.findSessionByJoinCode(joinCode);
    await this.persist();
    return { sessionId: session.id, joinCode: session.joinCode, playerId: player.id, player, session };
  }

  async operatorAction(sessionId, action) {
    await this.ready;
    const session = this.engine.operatorAction(sessionId, action);
    await this.persist();
    return { session };
  }

  async submitAnswer({ sessionId, playerId, choiceId, idempotencyKey }) {
    await this.ready;
    const answer = this.engine.submitAnswer({ sessionId, playerId, choiceId, idempotencyKey });
    await this.persist();
    return { answer, session: this.engine.requireSession(sessionId) };
  }

  async load() {
    try {
      this.engine.importState(JSON.parse(await readFile(this.statePath, "utf8")));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  async persist() {
    await mkdir(dirname(this.statePath), { recursive: true });
    await writeFile(this.statePath, JSON.stringify(this.engine.exportState(), null, 2));
  }
}
