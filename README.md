# Coba · The Shifting Front

A fresh implementation of Coba: a simultaneous-turn tactical card battler over three control zones, designed to grow into a cooperative faction war. The previous project is preserved in [`reference/poc/`](reference/poc/README.md); none of its code is imported by the new application.

**Status: private-alpha foundation, not production-ready.** Includes a playable two-human 1v1 client, two heroes, a deterministic engine, durable matches, private invite rooms, recoverable sessions, timed turns, command deduplication, and automated cloud verification. Account registration, matchmaking, 2v2 matchmaking/UI, faction progression, and production infrastructure are future milestones.

## Start here

- [Architecture and service decisions](docs/architecture.md)
- [Gameplay direction and playtest questions](docs/gameplay.md)
- [Production roadmap and release gates](docs/roadmap.md)
- [Cloud deployment and operations](docs/operations.md)
- [POC inventory and lessons](reference/README.md)

## Repository

| Path            | Responsibility                                                           |
| --------------- | ------------------------------------------------------------------------ |
| `apps/web`      | React + Vite client; player views only                                   |
| `apps/api`      | Fastify HTTP API, sessions, PostgreSQL transactions, deadline sweeper    |
| `packages/game` | Pure deterministic game rules and versioned content                      |
| `db/migrations` | Ordered, transactional PostgreSQL migrations                             |
| `tests`         | Rules, real database concurrency/recovery, two-browser gameplay          |
| `reference/poc` | Frozen historical implementation, content, documents, and infrastructure |

## Verification

The existing cloud-only verification preference is preserved. Do not start local app servers or install dependencies for local tests. GitHub Actions runs Node 24 and PostgreSQL 18, typechecks, exercises game invariants and competing API replicas, builds the web/API bundle, runs Playwright, and builds the deployment image. Browser screenshots and traces are retained as CI artifacts.

Commands below are for **CI/cloud execution**:

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run migrate
npm run test:browser
```

The cloud container runs `npm start` after a separate migration job. Required settings are in `.env.example`. All online players need the private playtest key, then receive an opaque HttpOnly session cookie. Use two separate browser profiles or devices: tabs in one profile intentionally share a seat. Reload restores the active match. Losing the cookie loses access to that anonymous seat.

No new cloud resources are provisioned and no old deployment or database is modified by this repository reset. Never point these migrations at the POC database; use a new database and host. Production rollout requires the gates in the operations guide.
