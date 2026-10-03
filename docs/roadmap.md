# Roadmap to production

Sequence by evidence and exit gates, not a promised launch date. Approximate months assume a small team; re-estimate after the first playtests.

| Stage                            | Deliverables                                                                                                                                  | Exit gate                                                                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Foundation — this change         | Archived POC, new engine/API/client, durable commands/deadlines/results, private invites, cloud CI                                            | Rules, DB concurrency/recovery, browser flow, responsive layout, and image build pass                                               |
| Month 1 — playable private alpha | New staging stack, account provider integration, tutorial/bot, rematch, history/replay tooling, metrics, two heroes tuned by people           | 20+ complete playtest sessions; server kill/deploy does not lose a committed move; documented restore drill                         |
| Month 2 — social multiplayer     | Parties, 2v2 client/queues, team pings, matchmaking/rating, region policy, accessibility/device polish                                        | Four-player games, reconnects, unfair match prevention, no hidden-information leaks; players report coordination is worthwhile      |
| Month 3 — faction alpha          | Seasonal faction choice, small territory map, result consumer/ledger, capped contribution, anti-collusion, cosmetic progression               | Duplicate delivery never double-rewards; campaign remains fair with uneven populations; outcome audit/reversal tooling works        |
| Month 4+ — production beta       | Multi-AZ infrastructure as code, SLO alerts, load/soak/chaos tests, content pipeline, account recovery/deletion, moderation, mobile profiling | Capacity and failure budgets met at ≥2× forecast peak; on-call and rollback/restore rehearsed; product retention supports expansion |

## Public alpha blockers

- Replace anonymous playtest sessions with durable provider-linked identities and recovery. Migrate session-owned seats/history deliberately rather than reusing POC auth tables.
- Add shared abuse controls and administrative tools. Current per-process rate limiting is only a private-alpha guard; a proxy can make many users share one limit, and replicas multiply the limit. Configure trusted proxy ranges and enforce public quotas at the edge.
- Add match listing/rejoin across devices, expiration/cleanup policies, queue cancellation, reporting, and a lifecycle for abandoned lobbies. Current host can create five recent active rooms, but no long-term retention worker is shipped.
- Add version dispatch, replay validation, and deployment compatibility checks before changing released balance rules.
- Instrument command latency, timeout lag, lock contention, errors, disconnects, invalid actions, match completion, and resource consumption.
- Provision and test HA database/replicas and deploy through a staged immutable artifact pipeline. Do not confuse a Docker build with high availability.
- Browser CI covers the happy-path match and reload; add lost-response UI recovery, offline/online transitions, Safari/iOS, accessibility audit, full-match/reward flow, and poor-network playtests before broad access.

## Explicitly deferred

Payments, gacha, trading, player-generated competitive cards, chat, live AI opponents, mobile store release, active-active databases, and Kubernetes. Revisit only when product requirements justify their operating cost.

## First next increment

Select a staging cost envelope, provision a new isolated database and two app replicas, deploy the verified image, then play the same match while terminating one replica. Capture latency and deadline lag, restore the database to a fresh instance, and record evidence. Keep the old POC online until the new staging build has earned replacement.
