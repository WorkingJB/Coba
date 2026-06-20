# Coba — Prototype

A 2v2 hero-based tactical card battler (see [`ARCHITECTURE.md`](./ARCHITECTURE.md) for
the full design). This repo has progressed through **Build Sequence step 4** of that doc:

| Step | What | Status |
| --- | --- | --- |
| 1 | Pure card-resolution engine (console only) | ✅ `src/`, `npm run sim` |
| 2 | Browser client, human vs bot (DOM, no backend) | ✅ `src/web/`, `npm run dev` |
| 3 | Auth + deck persistence | 🚧 Phase A live (Better Auth + MPG, online gating, **preview allowlist**) |
| 4 | Networked human-vs-human (Colyseus, room codes) | ✅ **live at https://app.coba.games** |
| 5 | Hero abilities + territory modifiers | ⏳ started early |
| 6 | Faction war map | — last |

The engine is the shared authority: the **same** `src/engine.ts` runs in the console
simulator, the local bot client, and server-side in Colyseus.

## Run it

```bash
npm install
npm run sim          # one verbose match, turn by turn
npm run sim:bench    # 200 matches per matchup/territory, prints win rates
npm run dev          # browser client (vs bot), no backend
npm run server       # + Colyseus match server (for local human-vs-human)
npm run typecheck    # tsc --noEmit (covers src/ and server/)
```

## What's modeled

- **1v1, three control points** (LEFT / CORE / RIGHT). Hold a zone at end of turn → +1 point. First to 12 (or most at the turn cap) wins.
- **Simultaneous resolution.** Both players' locked actions resolve together each turn: units deploy first, then buffs amplify, then spells (against a shared snapshot), then hero abilities, then scoring.
- **Hero = archetype.** Five starter heroes (the full design-target roster), each a 12-card deck with a real curve (multiple cheap plays so turn 1 isn't dead), a board-wide card, and a signature ability:
  - **The Warden** — Defense / Zone Control (durable units; `bastion` reinforces every zone; ability **Entrench**: free +5 presence to a zone)
  - **The Shade** — Burst / Tempo (cheap units, removal that seizes; `volley` hits every zone; ability **Eviscerate**: free remove 4 + plant 2 in a zone)
  - **The Conjurer** — Summon / Board Presence (goes wide; `swarm`/`conjure`/`legion` spread presence across every zone; ability **Manifest**: free +4 presence to a zone). No removal — strong on Ancient Forest, weak on Volcanic Forge.
  - **The Oracle** — Support / Buffs (banks presence with bodies, then `buff` cards add flat presence *and* amplify the zone by 40%; ability **Rally**: free +2 then +40% in a zone). A force multiplier for *flipping contested zones* — hard-countered by removal.
  - **The Magus** — Arcane / Spell Control (percentage removal: `unravel`/`disjunction` strip 40% of a zone — or *every* zone — the answer to big stacks; ability **Nullify**: free remove 3 + plant 1). Dominant on Volcanic Forge, weak on Ancient Forest.
- **Hero abilities** are free, cooldown-gated (4 turns) signature moves you fire *alongside* your card for big "burst turns" — the main dynamism lever.
- **`allZones` cards** apply their effect to all three zones at once — big board-wide swings.
- **Guaranteed playable opening** — the opening hand always contains a turn-1-castable card.
- **Territory modifiers change rules, not power.** `volcanic_forge` (+2 spell), `ancient_forest` (+1 unit), `neutral_field` (none).

## Layout

| File | Responsibility |
| --- | --- |
| `src/types.ts` | Domain types (state, cards, heroes, actions, result) |
| `src/engine.ts` | `initGame`, `resolveTurn`, `checkWinCondition`, `legalActions` — the authority |
| `src/cards.ts` | Card catalog |
| `src/heroes.ts` | Starter heroes / deck lists |
| `src/territory.ts` | Battlefield rule modifiers |
| `src/bot.ts` | Greedy self-play policy (for validation only) |
| `src/rng.ts` | Seeded PRNG so runs are reproducible |
| `src/sim.ts` | Console harness (verbose + bench modes) |

The engine is intentionally pure (state in → state out) so the **same module can
later run client-side for prediction and server-side in Colyseus as the
authority**, per the architecture.

## Balance pass — current state

Self-play (greedy bot, so directional not definitive), N=1000/cell (≈±1.6%):

| Battlefield | Warden vs Shade (P1 win%) |
| --- | --- |
| Neutral Field | **54%** — balanced baseline ✅ |
| Volcanic Forge (spell buff) | 13% — Shade favored |
| Ancient Forest (unit buff) | 70% — Warden favored |

(Re-balanced twice: first after the card-pool expansion, then after adding hero abilities.
Abilities are **high-leverage** — 1 point of Entrench swung the matchup ~20% and the greedy
bot's use of them is bimodal, so a 4-turn cooldown was used to settle it. Final ability
tuning should come from human play, not the bot.)

What the pass established:

1. **The imbalance was structural, not numeric.** In a pure-accumulation model, removal-only spells *deny* (make a zone 0–0 = contested) but never *take* zones, so the Shade could never out-score the Warden's stacking walls. Number tweaks barely moved it; presence *decay* made it worse (erodes small bodies faster than big walls).
2. **The fix was a rule, not a stat:** spells now remove enemy presence **and** plant a little of the caster's own ("strike and seize") — see `selfPresence` in `cards.ts`. That makes burst/tempo able to flip zones, landing Neutral at ~47/53.
3. **Territory shifts the matchup ±40% without touching card power** — the "rules not power" lever, proven.
4. **Mirror lean was a real engine bug, now fixed.** A diagnostic (N=4000) showed the *spell* deck mirror leaning 32/61 to P2 while the *all-unit* mirror was balanced — pinpointing spell-resolution ordering. Spells were resolving P1-then-P2, letting P2 remove presence P1 had just planted. Fixed by resolving all spells **simultaneously against a post-unit snapshot** (`resolveTurn` in `engine.ts`), which also honors the game's simultaneous-resolution pillar. Both mirrors now sit at ~47–49%.

### Known issues / next tuning

- **Volcanic Forge swing is very strong** (Warden 46% → 7%); the +2/spell modifier likely wants toning down now that the Shade runs 6 spells.
- Greedy bot rarely opens the *third* zone if it can hold two — a bot limitation; a human will contest all three.
- **Hero abilities are high-leverage and bot-tuned** — the win-rate is sensitive to ±1 on ability numbers; expect to retune from human play.
- Networked human-vs-human (step 4) is in; no persistence (step 3) yet.

## Browser client (step 2) — human vs bot

A lightweight DOM client (no backend, runs entirely client-side) lets a human pilot
P1 against the greedy bot for real playtesting:

```bash
npm run dev      # open the printed localhost URL, play in the browser
```

The client has two screens (`src/web/main.ts`):

- **Hero select** — pick your hero from a side-by-side view of each one's full **deck
  library** (cards grouped with counts), choose a battlefield, read the "how a match
  works" rules panel, then start. The bot takes the other hero.
- **Match** — header shows an explicit **energy readout** (`⚡ 1/1 (+1 each turn, max 8)`).
  Points and zones-held live on the **scoreboard** with an animated `+N` per-turn delta,
  **separated from the action log** (which now lists only card plays, colored YOU / BOT) so
  it's clear what the bot did vs. what scored. Each held zone shows a `★ +1` pip.

  Your **hero ability** sits above the hand: when ready, press **Use Ability** then aim a
  zone — it fires *alongside* your card play this turn (a "burst turn"), then goes on cooldown.

When you lock in a move, both sides are committed and the client holds a ~1s **reveal
beat** (`REVEAL_MS`) before resolving — so the board doesn't snap instantly. Board-wide
(`allZones`) cards offer a **Cast Everywhere** button instead of zone targeting.

This is deliberately DOM, not Phaser: the goal of step 2 is to *validate the loop with
a human* as fast as possible. Phaser/canvas juice layers on later without touching the
engine (the engine stays the shared authority).

## Multiplayer (step 4) — human vs human

**Live at https://app.coba.games** — open it in two places, one **Create Room**, one
**Join Room** with the shared code. (`www.coba.games` is the coming-soon/waitlist page.)

An authoritative [Colyseus](https://colyseus.io) server (`server/`) reuses the **same**
`src/engine.ts` as the simulator and bot client — resolution only ever happens on the
server. Players match via a short **room code** (host creates, opponent joins). The
server owns the RNG and **redacts each player's view** so the opponent's hand never
crosses the wire. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) §4.

**Online play requires an account** (email + password, via [Better Auth](https://better-auth.com)):
the server gates every match join on a valid session (`CobaRoom.onAuth`). **Play vs Bot stays
anonymous** — it never touches the server. See [`ARCHITECTURE.md`](./ARCHITECTURE.md) §6.3 and
[`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md) Step 3.

### Protocol (client ⇄ server)

| Message | Dir | Payload |
| --- | --- | --- |
| `seat` | →client | `{ seat, code }` — which side you control |
| `lobby` | →client | `{ code, players, heroes, territory }` |
| `state` | →client | `{ state, result, seat }` — full **redacted** `GameState` after each resolve |
| `locked` | →client | `{ seat }` — opponent locked (never *what* they locked) |
| `opponentLeft` | →client | match ended early |
| `lock` | →server | a `PlannedAction`; server resolves once **both** seats have locked |

### Run it locally (two terminals)

```bash
npm run server   # Colyseus match server on :2567
npm run dev      # Vite client on :5173 (auto-connects to the server)
```

Open the client in **two browser tabs**: one picks **Create Room** (shows a 4-letter
code), the other picks **Join Room** and enters it. The bot mode (**Play vs Bot**) still
runs entirely client-side with no server.

| File | Responsibility |
| --- | --- |
| `server/CobaRoom.ts` | Authoritative 2-player room: lobby, both-locked resolution, hand redaction |
| `server/index.ts` | Colyseus + Express; serves the built client in production |
| `src/web/net.ts` | `colyseus.js` wrapper (create/join by code, lock, callbacks) |

### Deploy to Fly.io (over-the-internet testing)

> **Authoritative runbook is [`DEPLOY.md`](./DEPLOY.md).** Prod is now app **`coba-prod`**
> (host-routed: game at `app.coba.games`, marketing at `www.coba.games`); staging is `coba-test`.
> The old single `coba-246` app is being decommissioned. The notes below are the original
> single-app sketch, kept for context.

One app serves both the websocket traffic and the built client. The `Dockerfile` runs
`vite build` then `npm run start`.

```bash
fly deploy --ha=false    # build image + ship as a SINGLE machine (app coba-prod)
fly logs -a coba-prod    # tail server output
fly open -a coba-prod    # open https://coba-prod.fly.dev
```

> **`--ha=false` is required.** Match rooms are in-memory, so both players must hit the
> same instance. Fly's default deploy creates two machines, which would split rooms
> across nodes; scaling past one machine needs the Colyseus Redis driver (see
> `ARCHITECTURE.md` §4), not a config change.

`fly.toml` keeps one machine warm (`auto_stop_machines = false`, `min_machines_running = 1`)
so a live match isn't killed mid-game — a small continuous cost. Between test windows:

```bash
fly machine stop -a coba-246     # idle it to stop billing for compute
fly machine start -a coba-246    # bring it back before a session
```

No database or secrets are needed for this milestone — persistence is step 3.

#### First-time setup (already done — for reference)

```bash
fly apps create coba-246 --org coba-246   # create the app in the project org
fly deploy --ha=false                     # initial deploy
```
