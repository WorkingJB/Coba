# Coba — Unified Architecture

> **One-sentence pitch:** A 2v2 hero-based tactical card battler where players fight over three strategic zones, and every victory helps their faction conquer a persistent world map that unlocks new cards, missions, and seasonal rewards.

This document reconciles the competing design outlines into a single source of truth. It records what we are building, what we deliberately are **not** building, and the technical architecture that gets us from a shareable web prototype to a native mobile launch without a rewrite.

---

## 1. Design Pillars (the settled questions)

These were debated across both outlines and are now decided.

| Decision | Resolution | Why |
| --- | --- | --- |
| Genre | Hero-based tactical card combat with territory control | Keeps MOBA *identity* (heroes, roles, objectives, teamplay) without MOBA *cost* (real-time movement, last-hitting, pathing, 30-min matches) |
| Match length | 5–10 minutes | Mobile-first; "understand your first match in 60 seconds" |
| Team size | **Start 1v1, ship 2v2** | Faster queues, easier balance, lighter netcode, indie-realistic scope. 3v3+ is a later expansion |
| Map structure | 3 control points (LEFT / CORE / RIGHT) instead of lanes | Preserves positional strategy, removes lane complexity |
| Turn system | **Simultaneous planning + resolution phase** | Mind games, prediction, faster pace, mobile-friendly vs. sequential Hearthstone turns |
| Hero model | **Hero = deck archetype, not a skin** | Unlocking a hero unlocks a *playstyle*; gives progression + variety + monetization with far fewer cards |
| Team coordination | **Asynchronous** — coordinate faction/deck *before* the match, then play your zone solo | Synchronous team play on mobile collapses on disconnect/slow teammates. This is the single most important netcode-shaping decision |
| Meta layer | Helldivers-style persistent faction war | The real differentiator — "our faction captured the Ash Wastes last night" beats "+3 fire damage" |
| Territory effect | Changes **gameplay rules and card availability**, never raw power | Avoids power creep; makes the war meaningful without balance spirals |
| Art (prototype) | ASCII / placeholder, committed as a deliberate aesthetic | Fine for validation. NOT the ship bar — revisit before launch |
| Monetization | **Free-to-play** at launch | Lowest entry friction; cosmetic-only model is the leaning (preserves "availability not power") but not yet locked |
| Platform order | **Web first → iOS → Android** | Lowest prototype friction; iOS is the first native target via Capacitor |
| Match server | **Colyseus** (purpose-built multiplayer server) | Chose a service meant for the use case over general-purpose Edge Functions |
| Faction commitment | **Seasonal** | Re-engagement each season; avoids permanent lock-in |

### The three heroes → archetype mapping (starter set)

| Hero | Deck Identity |
| --- | --- |
| Tank | Defense / Zone Control |
| Assassin | Burst / Tempo |
| Support | Buffs / Healing |
| Mage | Combo / Spell Control |
| Summoner | Board Presence |

Prototype ships **2 heroes**; the table is the design target once the loop is validated.

---

## 2. What We Are NOT Building

Explicitly cut to protect scope:

- ❌ Real-time movement, pathing, last-hitting, twitch mechanics
- ❌ A full real-time MOBA (that's a 6-year project, not a mobile game)
- ❌ Genshin-style gacha
- ❌ Massive hero roster (hundreds of cards)
- ❌ 3D worlds / open world anything
- ❌ Complex crafting
- ❌ Synchronous in-match team dependency

Kept: heroes, decks, territory war, cosmetics, team strategy.

---

## 3. Game Loop Architecture

### 3.1 Match flow (a single battle)

```
                ┌─────────────────────────────────────────┐
                │  PLANNING PHASE (30s, simultaneous)       │
                │  Each player selects: Card · Target · Zone│
                │  Everyone locks in independently          │
                └───────────────────┬─────────────────────┘
                                     ▼
                ┌─────────────────────────────────────────┐
                │  RESOLUTION PHASE                         │
                │  Locked actions execute in priority order │
                │  State updates, zone control recalculated │
                └───────────────────┬─────────────────────┘
                                     ▼
                 repeat until win condition on control points
                                     ▼
                ┌─────────────────────────────────────────┐
                │  MATCH RESULT → contributes to faction war│
                └─────────────────────────────────────────┘
```

The three control points each resolve as their own mini-battle:

```
[ LEFT / RUINS ]   [ CORE / CITADEL ]   [ RIGHT / FOREST ]
```

### 3.2 The card engine comes first (no graphics)

The first thing built is the **pure rules engine** in TypeScript — zero rendering:

```ts
playCard(hero, card, zone, gameState): GameState
resolveTurn(lockedActions[], gameState): GameState
checkWinCondition(gameState): MatchResult | null
```

Validate it with ~20 console-only matches before any Phaser code touches it. **The faction/territory system can be bolted onto a solid match loop; it cannot save a bad one.**

### 3.3 Territory modifiers (rules, not power)

Each battlefield alters *how* cards behave:

| Battlefield | Modifier |
| --- | --- |
| Volcanic Forge | Damage cards resolve stronger |
| Ancient Forest | Healing stronger |
| Crystal Ruins | Spell costs reduced |
| Frozen Bastion | Slower ultimate charge |

### 3.4 Faction war → card *availability* (the underexplored hook)

When a faction captures a territory (e.g. **Arcane Academy**), every member gains time-limited access to that territory's card pool, cosmetics, and missions for the week. Lose the territory → lose access. This makes the persistent war matter at the deck level, not as a stat buff.

---

## 4. Technical Architecture

### 4.1 Stack

| Layer | Choice | Rationale |
| --- | --- | --- |
| Client | **Phaser 3 + TypeScript** | Purpose-built 2D browser game engine; good sprite/card handling; web-first with no install friction via WebAssembly/Canvas |
| Native port path | **Capacitor** wrapping the web client | Minimal rework to reach iOS/Android. If it gets real traction, rewrite client in Godot/Unity against the *same* backend |
| Backend / persistence | **Fly.io** (Managed Postgres + app services) | Consolidated onto Fly so the whole stack is one provider, one deploy: Postgres holds hero/deck progression, match history, and global map state. The realtime territory-conquest layer rides the same Colyseus server (broadcast, or Redis pub-sub to fan out) rather than a separate realtime service. (Supabase dropped — see §6.) |
| Match server | **Colyseus** (Node) on **Fly.io** | Authoritative state for simultaneous-turn / turn-based play; cheap at prototype scale. Co-located with Postgres on Fly, so server→DB calls stay in-region |
| Auth | **Better Auth (self-hosted lib) on Fly** | Decided 2026-06-19. Self-hosted Better Auth (TypeScript, email+password first) inside the Colyseus/Express server, data in Fly Managed Postgres — no second platform, no per-MAU cost. Lucia (the original candidate) was sunset in 2025; Better Auth is its maintained successor. Account required for online only. (see §6.3) |
| Turn validation | **Colyseus** authoritative rooms | Chosen as a service built for real-time multiplayer match state. Stateless edge-function approaches considered and rejected as a stopgap — go straight to the purpose-built tool |
| Card art (prototype) | Claude Code-generated ASCII / scaffolding | Fast for layout, card data, logic scaffolding |

### 4.2 Responsibility split

```
┌────────────────────────────────────────────────────────────┐
│ CLIENT  (Phaser 3 + TS, web → Capacitor)                    │
│  · Rendering, animation, input                              │
│  · Local copy of the rules engine for prediction/UI         │
└───────────────────────────┬────────────────────────────────┘
                            │ ws (match) + http (persistence)
                            ▼
┌────────────────────────────────────────────────────────────┐
│ FLY.IO  — single provider, one deploy, one region           │
│                                                            │
│  ┌──────────────────────────┐   ┌───────────────────────┐  │
│  │ COLYSEUS (authoritative)  │   │ MANAGED POSTGRES       │  │
│  │  · Match room state       │◄─►│  · Accounts (Better Auth)│ │
│  │  · Simultaneous-turn      │   │  · Decks, heroes, prog │  │
│  │    lock + resolution      │   │  · Faction map state   │  │
│  │  · Anti-cheat arbitration │   │  · Match history       │  │
│  │  · Realtime war broadcast │   └───────────────────────┘  │
│  └──────────────────────────┘                              │
│   in-region DB access; faction war tally written post-match │
└────────────────────────────────────────────────────────────┘
```

The rules engine is **shared code**: the same TypeScript module runs client-side (for responsive UI/prediction) and server-side in Colyseus (as the authority). Authoritative resolution always wins.

### 4.3 Data model (Fly Managed Postgres)

**Live as of A1 (2026-06-19):** Better Auth owns `user` / `session` / `account` / `verification`
(created by its migration, see `IMPLEMENTATION_PLAN.md` Step 3). The sketch below is the remaining
game-side schema to add as later phases land — a `profiles` row keyed off Better Auth's `user.id`
replaces the old standalone `players` table:

- `profiles` — game-side player data (faction, cosmetics owned), FK → Better Auth `user`
- `heroes` — archetype definitions (static/seed data)
- `cards` — card definitions, territory-pool tags
- `decks` — player-owned, hero-bound
- `matches` — result records that feed the war tally
- `territories` — persistent map state: owning faction, modifier, capture timer
- `faction_progress` — rolling contribution toward the next capture

The live war map is pushed from the Colyseus server when `territories` / `faction_progress` change — a Colyseus broadcast, with Redis pub-sub if it ever needs to fan out beyond a single node. No separate realtime service (this is the one capability Supabase gave nearly free; Colyseus already being a realtime server is what makes dropping it cheap).

### 4.4 Current deployment

The step-4 milestone is **live**. A single Fly machine (app **`coba-246`**, org `coba-246`, region `iad`, `shared-cpu-1x` / 256 MB) runs the Colyseus server and serves the built client at **https://coba-246.fly.dev**.

- **One machine, deliberately.** Match rooms are in-memory, so both players must land on the same instance. Deploy with `fly deploy --ha=false`; `fly.toml` pins `min_machines_running = 1` / `auto_stop_machines = false` so live matches aren't stopped mid-game. Scaling to multiple machines is a Colyseus Redis-driver change (the presence/driver this doc already anticipates for the war map), not a config flip.
- **No persistence or secrets** yet — players are ephemeral (step 3 deferred).
- **Cost note:** the always-on machine bills continuously; `fly machine stop -a coba-246` idles it between test windows.

---

## 5. Build Sequence

Disciplined sequencing wins (per the second outline); scope targets from the first outline apply only *after* the loop is proven fun.

1. **Card resolution engine** — pure TypeScript, console only. 2 decks, 3 zones, 1 territory modifier, 1 win condition. Prove it's fun in ~20 matches. ✅ **Scaffolded** — see [`README.md`](./README.md) and `src/`. Runs via `npm run sim` / `npm run sim:bench`. Balance pass done: Neutral Field ~47/53 (the fix was a *rule* — "strike and seize" spells — not a stat). The mirror lean turned out to be a real engine bug (spells resolving sequentially gave P2 a second-mover edge) — fixed by resolving spells simultaneously against a post-unit snapshot; mirrors now ~47–49%.
2. **Graphical client (human vs bot)** — drop rendering on top of the validated engine. Local/single-player vs the greedy bot, no backend. ✅ **Scaffolded** as a lightweight Vite + DOM client (`index.html`, `src/web/`); run `npm run dev`. *Note:* DOM rather than Phaser — fastest path to a human in the loop, which is step 2's whole purpose. Phaser/canvas juice layers on later without touching the engine. **No fly.io / Colyseus needed until step 4.**
3. **Auth + deck persistence (Fly Postgres)** — accounts, save decks. Auth mechanism **decided (2026-06-19): Better Auth (self-hosted) on Fly Managed Postgres**, email+password first, account required for online only. Deferred past the step-4 testing milestone; ready to build now (see `IMPLEMENTATION_PLAN.md` Step 3 for the phased plan).
4. **Second player** — Colyseus room, networked simultaneous-turn lock/resolution. ✅ **Shipped & deployed — live at https://coba-246.fly.dev** (see §4.4). Authoritative `CobaRoom` (`server/`) reuses the engine verbatim, server-owned RNG, both-locked resolution, and per-seat **hand redaction** so the opponent's hand never crosses the wire. Room-code matchmaking (host `create` / joiner `join`, `filterBy(['code'])`); client at `src/web/net.ts` + online flow in `src/web/main.ts`. One Fly app serves both the websocket and the built client (`server/index.ts`, `Dockerfile`, `fly.toml`); verified end-to-end over `wss` (two clients, authoritative resolve, redaction). **Leftover gaps now closed** (2026-06-19): reconnect-into-match (`allowReconnection`, 30s seat hold), rematch (both-vote re-init in the same room), and auto-queue (`coba_quick` public pool via `joinOrCreate`) — all verified end-to-end. Persistence (step 3) intentionally skipped for this testing milestone — players are ephemeral. Now runs on a **two-environment cloud setup**: staging `coba-test` → https://test.coba.games and production `coba-246` → https://www.coba.games (apex `coba.games` 301s to www); **all testing is cloud-only** (see [`CLAUDE.md`](./CLAUDE.md) + [`DEPLOY.md`](./DEPLOY.md)). See [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) for the live done/next tracker.
5. **Hero abilities + territory modifiers** — expand to the archetype roster. ⏳ **In progress — roster complete (5/5).** Every archetype now has a hero with a free, cooldown-gated signature ability: Warden *Entrench*, Shade *Eviscerate*, Conjurer *Manifest* (Summoner), Oracle *Rally* (Support — new `buff`/`amplify` mechanic), Magus *Nullify* (Mage — new `damageFrac` % removal). Ability kinds grew 2 → 3. Still to do: **more territories (≥4 target) + retune Ancient Forest's `allZones` amplification**; ability variety is largely covered.
6. **Faction war map** — persistent territory system, realtime updates pushed from the Colyseus server, capture → card-availability hook. Built **last**, on top of a solid loop.

Milestone gate between 1 and 2: *do not* render anything until the rules feel good in text.

---

## 6. Open Questions

Most prior questions are now closed (see §1). Remaining:

1. **Monetization detail** — Free-to-play is locked as the *entry model*. The revenue mechanic underneath it (cosmetic-only is the leaning) is not yet confirmed. Resolve before economy/art work.
2. **Ship art direction** — ASCII stays for the prototype. The launch visual bar is **deferred pending review with the game director** — there are many options worth evaluating together rather than committing now.
3. ✅ **Auth mechanism — resolved 2026-06-19** (was the last question gating the current build). → see Recently closed.

### Recently closed

- ✅ Monetization entry model → **free-to-play**
- ✅ Platform order → **web → iOS → Android**
- ✅ Match server → **Colyseus** (purpose-built, not stateless edge functions)
- ✅ Faction commitment → **seasonal**
- ✅ Backend / persistence → **consolidated on Fly.io** (Managed Postgres + the Colyseus app); Supabase dropped — one provider, one deploy, in-region DB access, and Colyseus already covers the realtime war map. Trade-off accepted: we own auth + the data API ourselves → **now resolved (see auth, below)**. Fly **Managed Postgres (MPG)** is since a real managed offering (HA, automated backups, connection pooling, private-network), so the earlier backup/HA maturity flag is largely addressed (community notes HA has nuances — fine for prototype progression data).
- ✅ Auth mechanism (2026-06-19) → **Better Auth (self-hosted TS lib) on Fly Managed Postgres**, email+password first, account required for online only. Better Auth is the maintained successor to Lucia (sunset 2025); keeps everything self-hosted on Fly, no second platform, no per-MAU cost. Build plan in `IMPLEMENTATION_PLAN.md` Step 3.

---

*Status: living document. Update as decisions in §6 close.*
