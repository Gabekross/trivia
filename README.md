# Family Trivia Codex

Phase 0/1 foundation for a live audience trivia platform. The app is intentionally self-contained for the first execution pass: it uses no downloaded packages, runs in a browser from a tiny Node static server, and keeps the game engine server-authoritative in shared modules that can later sit behind Next.js route handlers and Supabase RPC calls.

## What Is Included

- Operator, player, and main display browser surfaces.
- Configurable Race-to-X session creation.
- Short join codes, manually seeded questions, and mobile player join.
- Server-authoritative state machine, answer grading, leaderboard, winner pause, resume, reset, and end flows.
- Phase 2 winner-mode registry with Race-to-X, Hot Streak, Three Lives, Last Player Standing, Highest Score, and Tournament/Qualification.
- Mode-specific scoring/progression snapshots for player HUDs and display/operator surfaces.
- Shared public snapshot contracts that hide correct answers from player payloads until reveal.
- Trusted local backend endpoints for session creation, joining, operator actions, answer submission, and role-specific snapshots.
- Store adapter boundary with a working JSON store and a Supabase REST adapter for the deployment path.
- Shared HTTP runtime used by both the local Node server and the Vercel serverless entrypoint.
- JSON persistence in `data/trivia-state.json` plus server-sent events so connected clients can refresh from authoritative state.
- Supabase migration draft with tables, indexes, RLS posture, and atomic uniqueness constraints.
- Automated tests for state transitions, answer uniqueness, authorization boundaries, and Race-to-X tie behavior.
- Reproducible load-test harness for 50/100/200 simulated players.

## Run Locally

```bash
npm run dev
```

Open `http://127.0.0.1:4173`.

The local server exposes the Phase 1/2 mutation boundary:

- `GET /api/bootstrap`
- `GET /api/sessions/:id/snapshot?role=OPERATOR|PLAYER|DISPLAY`
- `GET /api/sessions/:id/events`
- `POST /api/sessions`
- `POST /api/join`
- `POST /api/sessions/:id/operator`
- `POST /api/sessions/:id/answers`

## Storage

Set `GAME_STORE=json` for the default local implementation. This stores the authoritative engine snapshot in `data/trivia-state.json`.

Set `GAME_STORE=supabase` when running in a trusted server environment such as Vercel route handlers. The Supabase adapter uses the service role key from the server only and persists the same authoritative engine snapshot through Supabase REST.

Apply both migrations before selecting the Supabase store:

- `supabase/migrations/0001_phase0_phase1_foundation.sql`
- `supabase/migrations/0002_engine_snapshot_store.sql`

The snapshot store is the first deployable persistence path. The normalized Phase 1 tables remain available for later content management, analytics, and richer audit/event reporting.

## Deployment Readiness

Before a public Vercel deploy:

- Create the Supabase project and run the migrations.
- Add `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` as server-side Vercel environment variables.
- Set `GAME_STORE=supabase` in the deployed server environment.
- Run `npm run deploy:check` after setting deployment environment variables.
- Keep `SUPABASE_SERVICE_ROLE_KEY` out of browser code and public client config.
- Re-run the multi-player browser smoke test using the deployed player, display, and operator links.

## Vercel Runtime

The production entrypoint is `api/index.mjs`. `vercel.json` rewrites all app, asset, and API traffic through that function so the existing frontend routes keep working:

- `/trivia`
- `/trivia/session/:joinCode`
- `/trivia/display/:sessionId`
- `/trivia/operator/:sessionId`
- `/api/*`

The local dev server and Vercel entrypoint both use `src/server/http-app.mjs`, so route behavior stays aligned. Local dev also keeps server-sent events for fast updates. The browser includes polling as a fallback so deployed/serverless clients continue refreshing even when long-lived event streams are unavailable.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run load:test
npm run deploy:check
```

`npm run deploy:check` validates production-style settings. It will fail until `GAME_STORE=supabase`, `NEXT_PUBLIC_SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY` are available in the environment.

## Environment Variables

The current local phase uses `GAME_STORE=json` and does not require live services. The future Supabase/Next integration should use:

- `GAME_STORE`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPERATOR_SESSION_SECRET`
