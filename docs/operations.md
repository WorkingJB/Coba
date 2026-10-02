# Cloud operations

## Current release boundary

This branch does not deploy infrastructure or touch existing Fly apps, domains, auth data, or production databases. It provides a portable image and automated cloud tests. Old Fly files are reference only. Use a new database and hostname for the rebuild; `sessions` and other tables are intentionally a fresh schema.

## CI

GitHub Actions provisions disposable PostgreSQL 18, uses Node 24, installs pinned dependencies, typechecks, runs rules and real-database tests, builds the app, migrates, runs Chromium with two isolated browser contexts, retains screenshots/traces, and builds the runtime container. Cloud CI loopback addresses are confined to runners; no app runs on the developer laptop.

## Private staging deployment

1. Choose the provider/cost envelope and a new app/database. Use managed HA PostgreSQL; configure TLS, private networking, credentials with least privilege, backups, and recovery access.
2. Build a release image from a passing commit and record its immutable digest. Run `npm run migrate` once as a release job with a migration role. The runner uses an advisory transaction lock; successful migrations are recorded. Do not use the runtime role for schema management in production.
3. Start at least two containers behind a health-checking load balancer, with distinct failure placement. Set `DATABASE_URL`, exact external `APP_ORIGIN` (scheme + host, no trailing slash), a random `PLAYTEST_ACCESS_KEY` ≥16 characters, `NODE_ENV=production`, and `PORT=8080`. Supply secrets from the host's secret manager.
4. Route web and `/api` to the same origin. Terminate HTTPS; secure session cookies require HTTPS. The application requires an exact Origin header for all POSTs. Non-browser test clients must send it too. Do not use wildcard CORS.
5. Use `/health/live` for process health and `/health/ready` for database/schema reachability. Configure deregistration/draining before SIGTERM. Keep termination grace longer than request/database timeout budgets.
6. Smoke test two profiles/devices, lock a move, restart its serving replica, reload, and complete the turn through another replica. Test two replicas accepting simultaneous locks and two workers claiming deadlines.
7. Test database failover under writes and document ambiguous outcomes/retries. Restore backup to a separate database and verify match snapshots and the event/outbox trail before admitting a playtest cohort.

The container runs as a non-root user. The database pool is capped at ten per process. Budget total app/worker/migration connections below the database limit, including deployments where old and new replica sets overlap. Database clocks decide deadlines; client clocks are presentation only.

## Failure behavior

| Event | Expected behavior | Operator response |
| --- | --- | --- |
| API process dies before transaction commit | No receipt; retry can apply once | Load balancer removes replica; investigate crash |
| Response lost after commit | Same command ID returns current authorized state | Client retries saved envelope; no manual replay |
| Both clients disconnect | Deadline sweeper passes missing turns; three consecutive misses end match | No room process needs to survive |
| All sweepers pause | Due turns wait; one turn resolves after recovery, with a fresh planning window | Alert on oldest due deadline; restore capacity |
| PostgreSQL unavailable | API returns temporary failure; readiness fails | Recover/fail over DB; never use a temporary in-memory match store |
| Result consumer unavailable | Terminal match and outbox entry remain durable | Retry consumer later with ledger dedupe |
| Browser cookie deleted/expires | Anonymous seat cannot be recovered | Known private-alpha limit; durable identity is a public-alpha blocker |

## Security / retention work before public access

Keep journal/state storage restricted to backend roles. Logs must never contain request bodies, cookies, access keys, raw hands, or database URLs. Current default request logging does not log bodies/headers; inspect any future instrumentation. Client errors are generic for unexpected failures; validation/business errors contain no private state.

Per-process throttling and a shared invite key are not public account security. The current application deliberately does not trust forwarded IP headers. Configure trusted proxy ranges plus edge-wide quotas before public access; do not blindly enable `trustProxy: true`.

Define retention and deletion for sessions, command receipts, abandoned lobbies, completed games, journals, and results. Session foreign keys prevent casual deletion of identity needed by receipts. Rotate the playtest key to stop new enrollment; this does not revoke existing sessions. Incident revocation can expire selected sessions in the database. Do not expose arbitrary SQL/admin APIs to players.

## Rollout and rollback

Run additive migrations first; deploy one canary and complete a two-client match; expand while watching command errors, latency, DB waits, and deadlines. Roll back the application artifact only while it understands the persisted ruleset/schema. Keep old ruleset implementations until active matches finish. Destructive schema contraction is a later release after rollback windows and backups.

Production readiness requires infrastructure as code, secret rotation, provider failover/restore evidence, capacity tests, monitoring, and an operator. Those are not supplied by the application code alone.
