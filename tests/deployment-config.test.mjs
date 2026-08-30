import assert from "node:assert/strict";
import test from "node:test";
import { deploymentConfig } from "../src/server/config.mjs";

test("local deployments may use the JSON store", () => {
  const config = deploymentConfig({ GAME_STORE: "json" });

  assert.equal(config.ok, true);
  assert.equal(config.gameStore, "json");
});

test("production requires Supabase storage", () => {
  const config = deploymentConfig({ GAME_STORE: "json", NODE_ENV: "production" });

  assert.equal(config.ok, false);
  assert.match(config.errors.join(" "), /GAME_STORE=supabase/);
});

test("Supabase storage requires Supabase credentials", () => {
  const config = deploymentConfig({ GAME_STORE: "supabase" });

  assert.equal(config.ok, false);
  assert.match(config.errors.join(" "), /NEXT_PUBLIC_SUPABASE_URL/);
  assert.match(config.errors.join(" "), /SUPABASE_SERVICE_ROLE_KEY/);
});

test("production Supabase config passes when required values exist", () => {
  const config = deploymentConfig({
    GAME_STORE: "supabase",
    NODE_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "secret",
    OPERATOR_SESSION_SECRET: "operator-secret"
  });

  assert.equal(config.ok, true);
});

test("production requires an operator secret", () => {
  const config = deploymentConfig({
    GAME_STORE: "supabase",
    NODE_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "secret"
  });

  assert.equal(config.ok, false);
  assert.match(config.errors.join(" "), /OPERATOR_SESSION_SECRET/);
});
