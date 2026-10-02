# CLAUDE.md

Coba — a 2v2 hero-based tactical card battler over three zones, with a persistent faction war.
Pure TS engine (`src/engine.ts`) shared by the simulator, web client, and authoritative server.

**Read these for context:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) (decisions/why),
[`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) (what's done / what's next — the live tracker),
[`README.md`](./README.md) (engine rules), [`DEPLOY.md`](./DEPLOY.md) (environments).

## ⛔ Standing rule: test in the cloud, never locally

**All testing happens on the deployed cloud environments. Do not test locally.** Concretely:

- **Do NOT** run local servers, dev servers, or sims to verify work — no `npm run dev`,
  `npm run server`, `npm run start`, `npm run preview`, `npm run sim`, `npm run sim:bench`,
  `vite`, or `tsx`-running the app. No `localhost` testing.
- **To verify a change:** deploy to **staging** and test there.
  - Staging: `fly deploy -c fly.staging.toml --ha=false` → **https://test.coba.games**
  - Production (only after staging looks good): `fly deploy --ha=false` → **https://www.coba.games**
- `node_modules` and `dist` are intentionally **not** kept locally — the Docker image builds them
  in-container, so deploys don't need them. Don't reinstall deps to run things locally.
- Editing code, reading files, and `git` are of course still local. It's *running/testing* that
  moves to the cloud.

This is a written rule (no enforcing hook) — follow it by default. See `DEPLOY.md` for the full
deploy + DNS runbook.

## Project shape

- `src/engine.ts` — pure rules engine (state in → state out). Shared everywhere.
- `src/cards.ts`, `src/heroes.ts`, `src/territory.ts` — content (data). 5 heroes, 3 territories.
- `src/bot.ts` — greedy reference bot (used by the balance sim; one move ahead).
- `src/web/` — Vite + DOM client. `server/` — authoritative Colyseus room + static host.
- `src/sim.ts` — balance harness (`npm run sim:bench`). It's a local node tool, but per the rule
  above, treat balance verification as a cloud/CI concern going forward rather than a local run.
