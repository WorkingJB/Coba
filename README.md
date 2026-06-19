# Cardito — Engine Prototype

Build Sequence **step 1** from [`ARCHITECTURE.md`](./ARCHITECTURE.md): the pure
card-resolution engine, console only, no graphics. The goal of this step is to
**prove the loop is fun in ~20 matches** before any Phaser or Colyseus code
exists.

## Run it

```bash
npm install
npm run sim          # one verbose match, turn by turn
npm run sim:bench    # 200 matches per matchup/territory, prints win rates
npm run typecheck    # tsc --noEmit
```

## What's modeled

- **1v1, three control points** (LEFT / CORE / RIGHT). Hold a zone at end of turn → +1 point. First to 12 (or most at the turn cap) wins.
- **Simultaneous resolution.** Both players' locked actions resolve together each turn: units deploy first, then spells, then scoring.
- **Hero = archetype.** Two starter heroes, each a fixed deck:
  - **The Warden** — Defense / Zone Control (durable, high-presence units)
  - **The Shade** — Burst / Tempo (cheap units + presence-removal spells)
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
| Neutral Field | **47%** — balanced baseline ✅ |
| Volcanic Forge (spell buff) | 10% — Shade favored |
| Ancient Forest (unit buff) | 79% — Warden favored |

What the pass established:

1. **The imbalance was structural, not numeric.** In a pure-accumulation model, removal-only spells *deny* (make a zone 0–0 = contested) but never *take* zones, so the Shade could never out-score the Warden's stacking walls. Number tweaks barely moved it; presence *decay* made it worse (erodes small bodies faster than big walls).
2. **The fix was a rule, not a stat:** spells now remove enemy presence **and** plant a little of the caster's own ("strike and seize") — see `selfPresence` in `cards.ts`. That makes burst/tempo able to flip zones, landing Neutral at ~47/53.
3. **Territory shifts the matchup ±40% without touching card power** — the "rules not power" lever, proven.
4. **Mirror lean was a real engine bug, now fixed.** A diagnostic (N=4000) showed the *spell* deck mirror leaning 32/61 to P2 while the *all-unit* mirror was balanced — pinpointing spell-resolution ordering. Spells were resolving P1-then-P2, letting P2 remove presence P1 had just planted. Fixed by resolving all spells **simultaneously against a post-unit snapshot** (`resolveTurn` in `engine.ts`), which also honors the game's simultaneous-resolution pillar. Both mirrors now sit at ~47–49%.

### Known issues / next tuning

- **Volcanic Forge swing is strong** (Warden 47% → 10%); the +2/spell modifier may want toning down.
- Greedy bot rarely opens the *third* zone if it can hold two — a bot limitation; a human will contest all three.
- No hero *abilities* yet (step 5), no networking (step 4), no persistence (step 3).

## Browser client (step 2) — human vs bot

A lightweight DOM client (no backend, runs entirely client-side) lets a human pilot
P1 against the greedy bot for real playtesting:

```bash
npm run dev      # open the printed localhost URL, play in the browser
```

When you lock in a move, both sides are committed and the client holds a ~1s **reveal
beat** (`REVEAL_MS` in `src/web/main.ts`) before resolving — so the board doesn't snap
instantly and you can read what the bot did. The turn log is colored YOU / BOT.

This is deliberately DOM, not Phaser: the goal of step 2 is to *validate the loop with
a human* as fast as possible. Phaser/canvas juice layers on later without touching the
engine (the engine stays the shared authority).
