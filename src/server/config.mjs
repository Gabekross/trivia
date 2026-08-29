export function deploymentConfig(env = process.env) {
  const gameStore = env.GAME_STORE || "json";
  const isProduction = env.VERCEL === "1" || env.NODE_ENV === "production";
  const errors = [];
  const warnings = [];

  if (!["json", "supabase"].includes(gameStore)) {
    errors.push(`GAME_STORE must be "json" or "supabase"; received "${gameStore}".`);
  }

  if (isProduction && gameStore !== "supabase") {
    errors.push("Production deployments must set GAME_STORE=supabase so state survives serverless invocations.");
  }

  if (gameStore === "supabase") {
    if (!env.NEXT_PUBLIC_SUPABASE_URL) errors.push("NEXT_PUBLIC_SUPABASE_URL is required when GAME_STORE=supabase.");
    if (!env.SUPABASE_SERVICE_ROLE_KEY) errors.push("SUPABASE_SERVICE_ROLE_KEY is required when GAME_STORE=supabase.");
  }

  if (!env.OPERATOR_SESSION_SECRET) {
    warnings.push("OPERATOR_SESSION_SECRET is not set; operator routes are not locked down yet.");
  }

  return {
    ok: errors.length === 0,
    gameStore,
    isProduction,
    errors,
    warnings
  };
}

export function assertDeploymentConfig(env = process.env) {
  const config = deploymentConfig(env);
  if (!config.ok) {
    throw new Error(`Invalid deployment config: ${config.errors.join(" ")}`);
  }
  return config;
}
