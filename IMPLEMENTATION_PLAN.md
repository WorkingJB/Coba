# Coba — Implementation Plan

**Purpose.** The single source of truth for *what is done vs. what is next*, written so a
fresh session can pick up without re-deriving state. It tracks **execution**; the *why* behind
each decision lives in [`ARCHITECTURE.md`](./ARCHITECTURE.md), and the engine rules live in
[`README.md`](./README.md). When a step closes here, update both this file and the matching
line in `ARCHITECTURE.md §5`.

_Last updated: 2026-06-19._

---

## Current state at a glance

| Layer | Status | Entry points |
| --- | --- | --- |
| Pure card engine | ✅ Validated, balanced (~47–49% mirrors) | `src/engine.ts`, `npm run sim`, `npm run sim:bench` |
| Web client (vs bot) | ✅ Working, DOM/Vite | `src/web/main.ts`, `npm run dev` |
| Online multiplayer | ✅ **Live** at https://coba-246.fly.dev | `server/`, `src/web/net.ts`, `npm run server` |
| Auth + persistence | ⏸️ Deferred (intentionally) | — |
| Hero/territory content | ⏳ 2/5 heroes, 3 territories | `src/heroes.ts`, `src/territory.ts` |
| Faction war map | 🔲 Not started (build last) | — |

**Verify everything still works:**
```bash
npm run typecheck        # tsc --noEmit, must be clean
npm run sim:bench        # engine balance sanity (~47–53% expected)
npm run build            # vite build → dist/
npm run server           # boots Colyseus + serves dist/ on :2567
```

---

## Build sequence status (mirrors `ARCHITECTURE.md §5`)

1. ✅ **Card resolution engine** — done, balanced.
2. ✅ **Graphical client (human vs bot)** — done.
3. ⏸️ **Auth + deck persistence** — *deliberately deferred* past the step-4 testing milestone. Blocked on the auth-mechanism decision (`ARCHITECTURE.md §6.3`).
4. ✅ **Second player (Colyseus)** — shipped, and **the leftover gaps are now closed** (see below).
5. ⏳ **Hero abilities + territory modifiers** — *current focus.* Roster is the next work. Fully enumerated below.
6. 🔲 **Faction war map** — built last, on the proven loop.

---

## ✅ Recently completed — Step 4 gap closure (2026-06-19)

The multiplayer milestone shipped with three named leftovers; all three are now done and
verified end-to-end (two real clients against a live server — see the integration checks below).

- **Reconnect-into-match** — `CobaRoom.onLeave(client, consented)` now distinguishes an
  intentional leave from a dropped socket. On a drop during an active match it holds the seat
  via `allowReconnection(client, 30s)`, broadcasts `opponentDropped`/`opponentReturned`, and
  pushes fresh authoritative state to the returning client. Client side (`src/web/net.ts`) runs
  a reconnection loop (`client.reconnect(reconnectionToken)`, 6× over ~30s) with a
  "Connection lost — reconnecting…" banner.
- **Rematch** — `rematch` message + both-seats vote in `CobaRoom`; the second vote reseeds the
  RNG and re-inits the match in the same room. Client shows a vote-aware Rematch button.
- **Auto-queue** — new `coba_quick` room registration (no `code` filter) joined via
  `joinOrCreate`; "Quick Match" menu flow in the client (server-assigned battlefield, no shared code).

**Verification performed:** `npm run typecheck` clean, `npm run build` clean, server boots and
registers both room types, and an end-to-end script drove two clients through auto-queue
pairing → simulated drop → reconnect-into-seat → fresh-state delivery → rematch guard (8/8 passed).

**Known follow-ups (not blocking Step 5):**
- No automated regression test is committed — the integration check was a throwaway script.
  Worth adding a `test/` harness if multiplayer churns further.
- Reconnect window (30s) and retry cadence are unverified under real mobile network conditions.
- Quick-match has no skill/rating bucketing — it's first-open-room. Fine for a testing pool.

---

## ⏳ Step 5 — Hero abilities + territory modifiers (NEXT, enumerated)

Goal: expand from the 2-hero proof to the **5-archetype starter set** (`ARCHITECTURE.md §1`),
add territory variety, and grow ability mechanics — *without* power creep (territories change
rules, not raw power).

### 5a. Hero roster — 2 of 5 built

| Archetype (design target) | Hero | Status | Engine fit |
| --- | --- | --- | --- |
| Tank — Defense / Zone Control | The Warden | ✅ built | existing |
| Assassin — Burst / Tempo | The Shade | ✅ built | existing |
| Summoner — Board Presence | _unbuilt_ | 🔲 | **pure data** — units + `allZones`, no new mechanics |
| Support — Buffs / Healing | _unbuilt_ | 🔲 | **needs engine work** — no "restore/buff own presence" mechanic exists |
| Mage — Combo / Spell Control | _unbuilt_ | 🔲 | **needs engine work** — "combo" implies cross-turn/sequence state |

**What the engine models today** (`src/types.ts`): cards are `unit` (adds presence) or `spell`
(removes enemy presence, optional `selfPresence`), with an `allZones` board-wide flag. Abilities
are `addSelf` or `removeFoe` (+ optional `selfPlant`), cooldown-gated. A new hero that fits these
primitives is **data only** (`src/heroes.ts` + cards in `src/cards.ts`). Anything else extends the
engine first.

**Recommended order** (cheapest/highest-confidence first):
1. **Summoner** — pure data; proves the "add a hero" pipeline end-to-end (deck + ability + bot
   handling + balance pass) with zero engine risk. Do this one first.
2. **Support** — design + add a `heal`/buff mechanic (e.g. ability kind `restoreSelf`, or a card
   that raises an existing zone's presence). Touch `engine.ts`, `types.ts`, `bot.ts`.
3. **Mage** — the hardest; "combo/spell control" needs a real sequencing hook (chain bonuses,
   delayed effects, or spell-cost reduction state). Design before building.

**Per-hero definition of done:** deck (12 cards, several ≤2-cost), one signature ability,
bot can play it (`src/bot.ts` heuristics cover the new mechanics), and a `sim:bench` balance
pass keeps matchups in ~45–55% (no archetype dominates).

### 5b. Territories — 3 built (1 neutral + 2 real)

| Territory | Rule | Status |
| --- | --- | --- |
| Neutral Field | none | ✅ |
| Volcanic Forge | spells remove +2 | ✅ |
| Ancient Forest | units +1 presence | ✅ |
| _more_ | rules-not-power modifiers | 🔲 enumerate during 5a |

Each new territory is a `TerritoryDef.modifyCard` in `src/territory.ts` (pure data). Design
targets: modifiers that interact with the *new* archetypes (e.g. a board that rewards healing,
or caps `allZones` swings) so content reinforces content. Keep them rule-shaped, never +X power
in the abstract.

### 5c. Ability variety
Abilities are currently 2 kinds (`addSelf`, `removeFoe`). Supporting Support/Mage means adding
kinds (heal/buff, delayed/combo). Extend `AbilityDef.kind` in `src/types.ts` and resolution in
`src/engine.ts`; update the client ability panel (`abilityPanel` in `main.ts`) and the bot.

### Step 5 exit criteria
5 heroes playable vs bot **and** online, ≥4 territories, bot competent with every mechanic,
balance bench shows no dominant archetype. Then re-evaluate Step 3 vs Step 6.

---

## Later steps (not started)

### Step 3 — Auth + deck persistence (deferred, sequenced before 6)
Fly Managed Postgres. Tables sketched in `ARCHITECTURE.md §4.3` (`players`, `heroes`, `cards`,
`decks`, `territories`, `faction_progress`). **Blocked on a decision:** auth mechanism is
unchosen (`§6.3` — self-hosted Lucia vs. in-house service vs. third-party IdP). Also flagged:
verify Fly Managed Postgres backup/HA maturity before betting progression data on it.

### Step 6 — Faction war map (build last)
Persistent territory state pushed from the Colyseus server (broadcast, Redis pub-sub if it
needs to fan out), capture → time-limited card-pool availability (`§3.4`). Sits on top of a
solid loop and real persistence — do not start before 3.

---

## Open decisions (gating, from `ARCHITECTURE.md §6`)

| # | Decision | Gates |
| --- | --- | --- |
| 1 | Monetization mechanic (cosmetic-only is the lean) | economy/art work |
| 2 | Launch art direction (ASCII is prototype-only) | needs game-director review |
| 3 | Auth mechanism (Lucia vs. in-house vs. IdP) | **Step 3** |

These are product decisions, not build tasks — surface them when their step comes up; don't
guess them in code.
