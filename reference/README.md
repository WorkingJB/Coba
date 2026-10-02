# POC reference archive

Archived from commit `a2ad812` on 2026-10-02. All tracked POC files are preserved byte-for-byte under `poc/`, including the old lockfile and CI definition. Git history remains intact. This directory is excluded from active compilation, Docker context, and runtime imports. The nested workflow is not executed by GitHub Actions.

## Keep as evidence

| Material | What it teaches us |
| --- | --- |
| `poc/ARCHITECTURE.md` | Original pitch: hero archetypes, simultaneous turns, three objectives, persistent faction identity |
| `poc/README.md` | Balance experiments; removal needs a way to seize territory; seat-order bugs distort mirror win rates |
| `poc/src/cards.ts`, `heroes.ts`, `territory.ts` | Six archetype sketches and content ideas, including Blight; candidates for redesign, not a balanced launch roster |
| `poc/src/engine.ts`, `rng.ts`, `sim.ts` | Pure engine and reproducible simulation pattern; old numbers and resolution ordering are not binding |
| `poc/server/CobaRoom.ts` | Private player views, invites, reconnect/rematch user journeys |
| `poc/src/web` | Prior playtest UX and interaction lessons |
| `poc/DEPLOY.md`, Fly configs, auth code | Historical environment/account integration reference; not new deployment configuration |

## Changes made deliberately

- Replace process-owned rooms with durable database-owned matches. Redis room discovery alone would not preserve a match after its owning process dies.
- Replace ad hoc messages with runtime-validated commands, stable retry IDs, turn preconditions, and transactions.
- Replace sequential effects with aggregated simultaneous presence/removal in the first ruleset. This intentionally changes the old deployment/buff/spell pipeline and needs fresh balancing.
- Keep two clear heroes for the first experiment. Archive all other content instead of importing it into the new balance model.
- Keep card access independent of faction victories for the initial competitive design. Snowballing economic advantages would undermine a persistent war.
- Keep cloud-only verification, while retiring the old requirement to deploy on a single machine.

Historical docs contain contradictory implementation status and obsolete instructions. Use the new `docs/` files for current decisions. Old URLs, database names, and account tables are not migration targets.
