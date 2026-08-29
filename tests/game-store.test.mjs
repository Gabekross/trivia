import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JsonGameStore } from "../src/server/stores/json-game-store.mjs";
import { SupabaseGameStore } from "../src/server/stores/supabase-game-store.mjs";

test("JsonGameStore persists sessions and reloads snapshots", async () => {
  const dir = await mkdtemp(join(tmpdir(), "trivia-store-"));
  const statePath = join(dir, "state.json");
  try {
    const firstStore = new JsonGameStore({ statePath, defaultSessionConfig: { title: "Store Test", targetCorrect: 1 } });
    const boot = await firstStore.bootstrap();
    const joined = await firstStore.joinSession(boot.joinCode, "Riley");
    await firstStore.operatorAction(boot.sessionId, "START");
    const operator = await firstStore.getSnapshot(boot.sessionId, "OPERATOR");
    const correct = operator.question.choices.find((choice) => choice.isCorrect);
    await firstStore.submitAnswer({ sessionId: boot.sessionId, playerId: joined.playerId, choiceId: correct.id, idempotencyKey: "persisted-answer" });

    const secondStore = new JsonGameStore({ statePath });
    const player = await secondStore.getSnapshot(boot.sessionId, "PLAYER", joined.playerId);

    assert.equal(player.session.title, "Store Test");
    assert.equal(player.session.winner.playerId, joined.playerId);
    assert.equal(player.player.currentAnswer.choiceId, correct.id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("SupabaseGameStore requires Supabase credentials", async () => {
  const store = new SupabaseGameStore();
  await assert.rejects(() => store.bootstrap(), /requires NEXT_PUBLIC_SUPABASE_URL/);
});

test("SupabaseGameStore persists through Supabase REST", async () => {
  const calls = [];
  let state = { sessions: [] };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes("/rest/v1/game_state_snapshots") && options.method === "GET") {
      return jsonResponse([{ state }]);
    }
    if (url.includes("/rest/v1/game_state_snapshots") && options.method === "PATCH") {
      state = JSON.parse(options.body).state;
      return emptyResponse();
    }
    if (url.includes("/rest/v1/game_session_index") && options.method === "POST") {
      return emptyResponse();
    }
    return textResponse(404, "not found");
  };

  const store = new SupabaseGameStore({
    supabaseUrl: "https://example.supabase.co",
    serviceRoleKey: "service-role",
    defaultSessionConfig: { title: "Supabase Store Test", targetCorrect: 2 },
    fetchImpl
  });
  const boot = await store.bootstrap();
  const joined = await store.joinSession(boot.joinCode, "Morgan");
  await store.operatorAction(boot.sessionId, "START");
  const operator = await store.getSnapshot(boot.sessionId, "OPERATOR");
  const correct = operator.question.choices.find((choice) => choice.isCorrect);
  await store.submitAnswer({ sessionId: boot.sessionId, playerId: joined.playerId, choiceId: correct.id, idempotencyKey: "supabase-answer" });
  const player = await store.getSnapshot(boot.sessionId, "PLAYER", joined.playerId);

  assert.equal(player.session.title, "Supabase Store Test");
  assert.equal(player.player.currentAnswer.choiceId, correct.id);
  assert.equal(state.sessions.length, 1);
  assert.ok(calls.some((call) => call.url.includes("/rest/v1/game_session_index")));
});

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body)
  };
}

function emptyResponse() {
  return {
    ok: true,
    status: 204,
    text: async () => ""
  };
}

function textResponse(status, body) {
  return {
    ok: false,
    status,
    text: async () => body
  };
}
