# Cardito — Unified Architecture

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
| Backend / persistence | **Supabase** | Auth, hero/deck progression, match history, and global map state. Realtime subscriptions drive the territory-conquest layer with little custom infra |
| Match server | **Colyseus** (Node) on a small VPS | Authoritative state for simultaneous-turn / turn-based play; cheap at prototype scale |
| Turn validation | **Colyseus** authoritative rooms | Chosen as a service built for real-time multiplayer match state. Supabase Edge Functions considered and rejected as a stopgap — go straight to the purpose-built tool |
| Card art (prototype) | Claude Code-generated ASCII / scaffolding | Fast for layout, card data, logic scaffolding |

### 4.2 Responsibility split

```
┌────────────────────────────────────────────────────────────┐
│ CLIENT  (Phaser 3 + TS, web → Capacitor)                    │
│  · Rendering, animation, input                              │
│  · Local copy of the rules engine for prediction/UI         │
└───────────────┬───────────────────────────┬────────────────┘
                │ realtime match traffic     │ persistent state
                ▼                            ▼
┌──────────────────────────┐   ┌────────────────────────────┐
│ COLYSEUS (authoritative)  │   │ SUPABASE                    │
│  · Match room state       │   │  · Auth / accounts          │
│  · Simultaneous-turn      │   │  · Decks, heroes, progress  │
│    lock + resolution      │   │  · Faction map state        │
│  · Anti-cheat arbitration │   │  · Realtime war subscriptions│
└───────────┬──────────────┘   └────────────┬───────────────┘
            │  match result                  │
            └──────────────►  writes to ◄────┘
                       faction war tally
```

The rules engine is **shared code**: the same TypeScript module runs client-side (for responsive UI/prediction) and server-side in Colyseus (as the authority). Authoritative resolution always wins.

### 4.3 Data model (initial sketch — Supabase)

- `players` — auth, faction, cosmetics owned
- `heroes` — archetype definitions (static/seed data)
- `cards` — card definitions, territory-pool tags
- `decks` — player-owned, hero-bound
- `matches` — result records that feed the war tally
- `territories` — persistent map state: owning faction, modifier, capture timer
- `faction_progress` — rolling contribution toward the next capture

Realtime subscription on `territories` + `faction_progress` powers the live war map without polling.

---

## 5. Build Sequence

Disciplined sequencing wins (per the second outline); scope targets from the first outline apply only *after* the loop is proven fun.

1. **Card resolution engine** — pure TypeScript, console only. 2 decks, 3 zones, 1 territory modifier, 1 win condition. Prove it's fun in ~20 matches. ✅ **Scaffolded** — see [`README.md`](./README.md) and `src/`. Runs via `npm run sim` / `npm run sim:bench`. Balance pass done: Neutral Field ~47/53 (the fix was a *rule* — "strike and seize" spells — not a stat). The mirror lean turned out to be a real engine bug (spells resolving sequentially gave P2 a second-mover edge) — fixed by resolving spells simultaneously against a post-unit snapshot; mirrors now ~47–49%.
2. **Graphical client (human vs bot)** — drop rendering on top of the validated engine. Local/single-player vs the greedy bot, no backend. ✅ **Scaffolded** as a lightweight Vite + DOM client (`index.html`, `src/web/`); run `npm run dev`. *Note:* DOM rather than Phaser — fastest path to a human in the loop, which is step 2's whole purpose. Phaser/canvas juice layers on later without touching the engine. **No fly.io / Colyseus needed until step 4.**
3. **Supabase auth + deck persistence** — accounts, save decks.
4. **Second player** — Colyseus room, networked simultaneous-turn lock/resolution.
5. **Hero abilities + territory modifiers** — expand to the archetype roster. ⏳ **Started early** (pulled forward from playtest feedback that the game needed to be "more dynamic"): each hero now has a free, cooldown-gated signature ability (Warden *Entrench*, Shade *Eviscerate*) playable in the web client. Still to do: more heroes, more territories, ability variety.
6. **Faction war map** — persistent territory system, realtime subscriptions, capture → card-availability hook. Built **last**, on top of a solid loop.

Milestone gate between 1 and 2: *do not* render anything until the rules feel good in text.

---

## 6. Open Questions

Most prior questions are now closed (see §1). Remaining:

1. **Monetization detail** — Free-to-play is locked as the *entry model*. The revenue mechanic underneath it (cosmetic-only is the leaning) is not yet confirmed. Resolve before economy/art work.
2. **Ship art direction** — ASCII stays for the prototype. The launch visual bar is **deferred pending review with the game director** — there are many options worth evaluating together rather than committing now.

### Recently closed

- ✅ Monetization entry model → **free-to-play**
- ✅ Platform order → **web → iOS → Android**
- ✅ Match server → **Colyseus** (purpose-built, not Edge Functions)
- ✅ Faction commitment → **seasonal**

---

*Status: living document. Update as decisions in §6 close.*
