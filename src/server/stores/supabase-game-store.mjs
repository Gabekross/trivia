import { GameStore } from "./game-store.mjs";
import { TriviaEngine } from "../../core/trivia-engine.mjs";

const MAX_WRITE_ATTEMPTS = 30;

class StateConflictError extends Error {
  constructor(message = "Game state changed before it could be saved.") {
    super(message);
    this.name = "StateConflictError";
  }
}

export class SupabaseGameStore extends GameStore {
  constructor({ supabaseUrl, serviceRoleKey, defaultSessionConfig = {}, engine = new TriviaEngine(), fetchImpl = fetch } = {}) {
    super();
    this.supabaseUrl = String(supabaseUrl || "").replace(/\/$/, "");
    this.serviceRoleKey = serviceRoleKey;
    this.defaultSessionConfig = defaultSessionConfig;
    this.engine = engine;
    this.fetch = fetchImpl;
    this.snapshotId = "primary";
    this.remoteRevision = 0;
    this.ready = this.load();
  }

  assertConfigured() {
    if (!this.supabaseUrl || !this.serviceRoleKey) {
      throw new Error("SupabaseGameStore requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    }
  }

  async bootstrap() {
    return this.mutateAndPersist(() => {
      let session = [...this.engine.sessions.values()].at(-1);
      if (!session) session = this.engine.createSession(this.defaultSessionConfig);
      return { sessionId: session.id, joinCode: session.joinCode };
    }, { persistIf: (result, beforeState) => beforeState.sessions.length === 0 });
  }

  async createSession(config = {}) {
    return this.mutateAndPersist(() => {
      const session = this.engine.createSession(config);
      return { sessionId: session.id, joinCode: session.joinCode, session };
    });
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

  async listSessionSummaries(options = {}) {
    await this.prepare();
    return this.engine.listSessionSummaries(options);
  }

  async saveQuestion(question) {
    return this.mutateAndPersist(() => question.id ? this.engine.updateQuestion(question.id, question) : this.engine.addQuestion(question));
  }

  async generateQuestionDrafts(input) {
    return this.mutateAndPersist(() => this.engine.generateQuestionDrafts(input));
  }

  async archiveQuestion(questionId) {
    return this.mutateAndPersist(() => this.engine.archiveQuestion(questionId));
  }

  async reviewQuestion(questionId, action) {
    return this.mutateAndPersist(() => this.engine.reviewQuestion(questionId, action));
  }

  async advanceTimers(sessionId) {
    return this.mutateAndPersist(() => {
      const session = this.engine.advanceTimers(sessionId);
      if (!session) return { sessionId, advanced: false, eventType: null };
      const eventType = session.auditLog.at(-1)?.eventType || "SESSION_UPDATED";
      return { sessionId, advanced: true, eventType, session };
    }, { persistIf: (result) => result.advanced });
  }

  async joinSession(joinCode, displayName, options = {}) {
    return this.mutateAndPersist(() => {
      const player = this.engine.joinSession(joinCode, displayName, options);
      const session = this.engine.findSessionByJoinCode(joinCode);
      return { sessionId: session.id, joinCode: session.joinCode, playerId: player.id, player, session };
    });
  }

  async operatorAction(sessionId, action) {
    return this.mutateAndPersist(() => {
      const session = this.engine.operatorAction(sessionId, action);
      return { session };
    });
  }

  async submitAnswer({ sessionId, playerId, choiceId, idempotencyKey }) {
    return this.mutateAndPersist(() => {
      const answer = this.engine.submitAnswer({ sessionId, playerId, choiceId, idempotencyKey });
      return { answer, session: this.engine.requireSession(sessionId) };
    });
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
    const rows = await this.request(`/rest/v1/game_state_snapshots?id=eq.${encodeURIComponent(this.snapshotId)}&select=state,revision`, {
      method: "GET"
    });
    const row = rows?.[0];
    const state = row?.state;
    this.remoteRevision = Number(row?.revision || 0);
    if (state) this.engine.importState(state);
  }

  async mutateAndPersist(operation, { persistIf = () => true } = {}) {
    let lastConflict = null;
    for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
      await this.prepare();
      const beforeState = this.engine.exportState();
      const expectedRevision = this.remoteRevision;
      const result = operation();
      if (!persistIf(result, beforeState)) return result;
      try {
        await this.persist({ expectedRevision });
        return result;
      } catch (error) {
        if (!isStateConflict(error)) throw error;
        lastConflict = error;
        await waitForRetry(attempt);
      }
    }
    throw lastConflict || new StateConflictError("Game state stayed busy for too long.");
  }

  async persist({ expectedRevision = this.remoteRevision } = {}) {
    const state = this.engine.exportState();
    const nextRevision = Number(expectedRevision || 0) + 1;
    const rows = await this.request(`/rest/v1/game_state_snapshots?id=eq.${encodeURIComponent(this.snapshotId)}&revision=eq.${encodeURIComponent(expectedRevision)}&select=revision`, {
      method: "PATCH",
      headers: { prefer: "return=representation" },
      body: {
        state,
        revision: nextRevision,
        updated_at: new Date().toISOString()
      }
    });
    if (!rows?.length) throw new StateConflictError();
    this.remoteRevision = Number(rows[0].revision || nextRevision);
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

function isStateConflict(error) {
  return error instanceof StateConflictError || error?.name === "StateConflictError";
}

async function waitForRetry(attempt) {
  const delayMs = Math.min(120, 8 + attempt * 4);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
