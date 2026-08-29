import { join } from "node:path";
import { assertDeploymentConfig } from "../config.mjs";
import { JsonGameStore } from "./json-game-store.mjs";
import { SupabaseGameStore } from "./supabase-game-store.mjs";

export function createGameStore({ kind = process.env.GAME_STORE || "json", statePath = join(process.cwd(), "data", "trivia-state.json") } = {}) {
  assertDeploymentConfig({ ...process.env, GAME_STORE: kind });

  if (kind === "json") {
    return new JsonGameStore({
      statePath,
      defaultSessionConfig: { title: "Family Trivia Night", targetCorrect: 2, timerSeconds: 15, maxPlayers: 200 }
    });
  }

  if (kind === "supabase") {
    return new SupabaseGameStore({
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      defaultSessionConfig: { title: "Family Trivia Night", targetCorrect: 2, timerSeconds: 15, maxPlayers: 200 }
    });
  }

  throw new Error(`Unknown GAME_STORE: ${kind}`);
}
