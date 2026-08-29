import { deploymentConfig } from "../src/server/config.mjs";

const config = deploymentConfig({ ...process.env, NODE_ENV: process.env.NODE_ENV || "production" });

if (config.warnings.length) {
  for (const warning of config.warnings) console.warn(`Warning: ${warning}`);
}

if (!config.ok) {
  for (const error of config.errors) console.error(`Error: ${error}`);
  process.exit(1);
}

console.log(`Deployment config ready: GAME_STORE=${config.gameStore}`);
