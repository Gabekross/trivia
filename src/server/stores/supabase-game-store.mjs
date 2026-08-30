import { GameStore } from "./game-store.mjs";
import { TriviaEngine } from "../../core/trivia-engine.mjs";

export class SupabaseGameStore extends GameStore {
  constructor({ supabaseUrl, serviceRoleKey, defaultSessionConfig = {}, engine = new TriviaEngine(), fetchImpl = fetch } = {}) {
    super();
    this.supabaseUrl = String(supabaseUrl || "").replace(/\/$/, "");
    this.serviceRoleKey = serviceRoleKey;
    this.defaultSessionConfig = defaultSessionConfig;
    this.engine = engine;
    this.fetch = fetchImpl;
    this.snapshotId = "primary";
    this.ready = this.load();
  }

  assertConfigured() {
    if (!this.supabaseUrl || !this.serviceRoleKey) {
      throw new Error("SupabaseGameStore requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    }
  }

  async bootstrap() {
    await this.prepare();
    let session = [...this.engine.sessions.values()].at(-1);
    if (!session) {
      session = this.engine.createSession(this.defaultSessionConfig);
      await this.persist();
    }
    return { sessionId: session.id, joinCode: session.joinCode };
  }

  async createSession(config = {}) {
    await this.prepare();
    const session = this.engine.createSession(config);
    await this.persist();
    return { sessionId: session.id, joinCode: session.joinCode, session };
  }

  async findSessionByJoinCode(joinCode) {
    await this.prepare();
    const session = this.engine.findSessionByJoinCode(joinCode);
    return session ? { sessionId: session.id, joinCode: session.joinCode, session } : null;
  }

  async getSnapshot(sessionId, role, playerId = null) {
    await this.prepare();
    return this.engine.snapshot(sessionId, role, playerId);
  }

  async listQuestions() {
    await this.prepare();
    return this.engine.listQuestions();
  }

  async saveQuestion(question) {
    await this.prepare();
    const saved = question.id ? this.engine.updateQuestion(question.id, question) : this.engine.addQuestion(question);
    await this.persist();
    return saved;
  }

  async generateQuestionDrafts(input) {
    await this.prepare();
    const questions = this.engine.generateQuestionDrafts(input);
    await this.persist();
    return questions;
  }

  async archiveQuestion(questionId) {
    await this.prepare();
    const question = this.engine.archiveQuestion(questionId);
    await this.persist();
    return question;
  }

  async reviewQuestion(questionId, action) {
    await this.prepare();
    const question = this.engine.reviewQuestion(questionId, action);
    await this.persist();
    return question;
  }

  async advanceTimers(sessionId) {
    await this.prepare();
    const session = this.engine.advanceTimers(sessionId);
    if (!session) return { sessionId, advanced: false, eventType: null };
    const eventType = session.auditLog.at(-1)?.eventType || "SESSION_UPDATED";
    await this.persist();
    return { sessionId, advanced: true, eventType, session };
  }

  async joinSession(joinCode, displayName, options = {}) {
    await this.prepare();
    const player = this.engine.joinSession(joinCode, displayName, options);
    const session = this.engine.findSessionByJoinCode(joinCode);
    await this.persist();
    return { sessionId: session.id, joinCode: session.joinCode, playerId: player.id, player, session };
  }

  async operatorAction(sessionId, action) {
    await this.prepare();
    const session = this.engine.operatorAction(sessionId, action);
    await this.persist();
    return { session };
  }

  async submitAnswer({ sessionId, playerId, choiceId, idempotencyKey }) {
    await this.prepare();
    const answer = this.engine.submitAnswer({ sessionId, playerId, choiceId, idempotencyKey });
    await this.persist();
    return { answer, session: this.engine.requireSession(sessionId) };
  }

  async load() {
    await this.loadRemoteState();
  }

  async prepare() {
    await this.ready;
    await this.loadRemoteState();
  }

  async loadRemoteState() {
    this.assertConfigured();
    const rows = await this.request(`/rest/v1/game_state_snapshots?id=eq.${encodeURIComponent(this.snapshotId)}&select=state`, {
      method: "GET"
    });
    const state = rows?.[0]?.state;
    if (state) this.engine.importState(state);
  }

  async persist() {
    const state = this.engine.exportState();
    await this.request("/rest/v1/game_state_snapshots?id=eq.primary", {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: {
        state,
        revision: Date.now(),
        updated_at: new Date().toISOString()
      }
    });
    await this.rebuildSessionIndex(state);
  }

  async rebuildSessionIndex(state) {
    const rows = state.sessions.map((session) => ({
      session_id: session.id,
      join_code: session.joinCode,
      status: session.status,
      title: session.configurationSnapshot.title,
      player_count: session.players.length,
      updated_at: session.updatedAt
    }));
    if (!rows.length) return;
    await this.request("/rest/v1/game_session_index", {
      method: "POST",
      headers: { prefer: "resolution=merge-duplicates,return=minimal" },
      body: rows
    });
  }

  async publishEvent(sessionId, eventType) {
    await this.request("/rest/v1/game_update_events", {
      method: "POST",
      headers: { prefer: "return=minimal" },
      body: {
        session_id: sessionId,
        event_type: eventType,
        created_at: new Date().toISOString()
      }
    });
    return { sessionId, eventType, published: true };
  }

  async request(path, { method, headers = {}, body } = {}) {
    this.assertConfigured();
    const response = await this.fetch(`${this.supabaseUrl}${path}`, {
      method,
      headers: {
        apikey: this.serviceRoleKey,
        authorization: `Bearer ${this.serviceRoleKey}`,
        "content-type": "application/json",
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Supabase request failed (${response.status}): ${detail}`);
    }

    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
}
