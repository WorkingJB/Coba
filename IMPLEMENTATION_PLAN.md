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
| Pure card engine | ✅ Validated, balanced (~47–49% mirrors) | `src/engine.ts`, `src/sim.ts` |
| Web client (vs bot) | ✅ Working, DOM/Vite | `src/web/main.ts` |
| Online multiplayer | ✅ **Live** — prod https://www.coba.games, staging https://test.coba.games | `server/`, `src/web/net.ts` |
| Cloud deploy / environments | ✅ Two-env Fly setup, custom domains live | `fly.toml`, `fly.staging.toml`, `DEPLOY.md` |
| Auth + persistence | ⏸️ Deferred (intentionally) | — |
| Hero/territory content | ⏳ 5/5 heroes ✅, 3 territories (≥4 target) | `src/heroes.ts`, `src/territory.ts` |
| Faction war map | 🔲 Not started (build last) | — |

**⛔ Testing is cloud-only — see [`CLAUDE.md`](./CLAUDE.md) + [`DEPLOY.md`](./DEPLOY.md).** Do not
run local dev/server/sim. To verify a change, deploy to **staging** and test the URL:
```bash
fly deploy -c fly.staging.toml --ha=false   # → https://test.coba.games  (test here)
fly deploy --ha=false                        # → https://www.coba.games   (prod, after staging)
```
`node_modules`/`dist` are intentionally not kept locally (Docker builds them in-container). The
balance sim (`npm run sim:bench`) is now a cloud/CI concern, not a local run — a CI workflow to run
typecheck + bench on push is a candidate follow-up if balance work resumes.

---

## 🎯 Next steps (start here)

**Finish Step 5 (current focus — 5a done, 5b/5c open):**
1. **Playtest the 5-hero roster on staging** (https://test.coba.games). The bench bot can't judge
   *feel* — this is the gap it can't cover. Watch the two new mechanics (Oracle buffs, Magus %
   removal) for clarity and fun. Feed findings back into tuning.
2. **5b — Territories:** add ≥1 more to hit the ≥4 target, AND retune **Ancient Forest** so its
   "+1 presence" stops amplifying `allZones` cards 3× (the Conjurer ~95%-on-Forest issue). This is
   a *territory* lever (`src/territory.ts`, pure data), deliberately deferred from the hero work.
3. **5c — Ability variety:** mostly covered (3 ability kinds now). Optional polish, not blocking.

**Then decide sequencing (Step 3 vs Step 6):**
- **Step 3 — Auth + persistence** is the sequential next build, but **blocked on the auth-mechanism
  decision** (open decision #3). Needs a product call before code.
- **Step 6 — Faction war map** is the headline feature but depends on Step 3 (persistence).

**Non-blocking quality/infra follow-ups (any time):**
- **CI workflow** (GitHub Actions): typecheck + `sim:bench` on push — replaces the removed local
  verification and fits the cloud-only rule.
- **Multiplayer regression tests** — the reconnect/rematch/auto-queue integration check was a
  throwaway script; commit a real harness if multiplayer churns.
- **Mobile/network reconnect testing** on staging (30s window unverified on real mobile).
- **Prod IPv4** — consider a dedicated address for stability (see `DEPLOY.md`).

---

## Build sequence status (mirrors `ARCHITECTURE.md §5`)

1. ✅ **Card resolution engine** — done, balanced.
2. ✅ **Graphical client (human vs bot)** — done.
3. ⏸️ **Auth + deck persistence** — *deliberately deferred* past the step-4 testing milestone. Blocked on the auth-mechanism decision (`ARCHITECTURE.md §6.3`).
4. ✅ **Second player (Colyseus)** — shipped, gaps closed, and now running on a **two-environment
   cloud setup** (staging + prod, custom domains). See the deployment milestone below.
5. ⏳ **Hero abilities + territory modifiers** — *current focus.* **5a roster ✅ complete (5/5);**
   5b territories + 5c ability variety remain. Fully enumerated below.
6. 🔲 **Faction war map** — built last, on the proven loop.

---

## ✅ Recently completed — Cloud environments & deploy (2026-06-19)

Stood up a proper two-environment cloud setup on Fly.io, and made **cloud the only place we test**
(standing rule — see [`CLAUDE.md`](./CLAUDE.md) + [`DEPLOY.md`](./DEPLOY.md)).

- **Staging** — Fly app `coba-test`, config `fly.staging.toml`, live at **https://test.coba.games**
  (suspends when idle for cost). Deploy: `fly deploy -c fly.staging.toml --ha=false`.
- **Production** — Fly app `coba-246`, config `fly.toml`, live at **https://www.coba.games**.
  Deploy: `fly deploy --ha=false`.
- **Custom domains** — all three Let's Encrypt certs **Issued** (`test`, `www`, apex `coba.games`);
  DNS A/AAAA records at the registrar (recorded in `DEPLOY.md`).
- **Apex redirect** — `coba.games` 301s → `www.coba.games` (path + query preserved), an app-level
  redirect in `server/index.ts` keyed on the apex Host. Verified live over HTTPS.
- **Local cleanup** — `node_modules` (73M) + `dist` removed; the Docker image builds them
  in-container, so deploys don't need them. No local dev/test going forward.

Workflow now: branch → `fly deploy -c fly.staging.toml` → test at test.coba.games → ship to www.

**Follow-ups:** no CI yet (typecheck + bench now have no automated gate — see Next steps); apex →
www works but apex SEO canonical is fine since it 301s.

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

## ⏳ Step 5 — Hero abilities + territory modifiers (5a ✅ done, 5b/5c remain)

Goal: the **5-archetype starter set** (`ARCHITECTURE.md §1`, ✅ complete), plus territory variety
and ability-mechanic growth — *without* power creep (territories change rules, not raw power).

### 5a. Hero roster — ✅ 5 of 5 built (complete)

| Archetype (design target) | Hero | Status | Engine fit |
| --- | --- | --- | --- |
| Tank — Defense / Zone Control | The Warden | ✅ built | existing |
| Assassin — Burst / Tempo | The Shade | ✅ built | existing |
| Summoner — Board Presence | The Conjurer | ✅ **built (2026-06-19)** | pure data — `allZones` units + single-zone bodies, `addSelf` ability |
| Support — Buffs / Healing | The Oracle | ✅ **built (2026-06-19)** | engine extended — new `buff` card kind + `amplify` ability kind |
| Mage — Combo / Spell Control | The Magus | ✅ **built (2026-06-19)** | engine extended — `damageFrac` (percentage removal) on spells |

**The roster (5/5) is complete.** Mirror balance is solid across all five heroes (46–49% P1 win,
i.e. no seat bias), and most cross-matchups at Neutral Field sit in 43–60%. The deliberate outliers
form a rock-paper-scissors spine — **Shade > Magus/Oracle**, **Magus > Oracle**, **Oracle > Warden/
Conjurer** — layered with territory swings (Volcanic Forge favors spell decks, Ancient Forest favors
unit decks). One observation for a future balance pass: **the Shade is the strongest hero overall**
(hard-counters both casters, even vs the rest). Left untouched here — it's a committed hero and
"finish the roster" isn't the brief to rebalance it.

**The Magus (built):** spell control via **percentage removal** — where the Shade does flat burst
removal (weak vs huge stacks), the Magus strips a *fraction* (`damageFrac`), the natural answer to
big presence (Warden walls, Oracle's amplified zones — it hard-counters the Oracle). `disjunction`
strips 40% of *every* zone (board-wide control). Light on bodies, so its spells seize to hold.
Ability **Nullify** (flat removeFoe, reused kind). Identity is strongly territorial: dominant on
Volcanic Forge (~78–100%), weak on Ancient Forest (~9–28% vs presence decks), mixed at Neutral.
Engine: `damageFrac` is a clean mirror of `amplify`; no client changes (all the existing `spell`
kind). **Balance lesson:** presence-generation (seize) dominated the win rate far more than the
removal fraction — stripping seize swung the Magus from ~90% to ~10%; the fraction was a minor knob.

> **Note on "Combo".** The design table calls the Mage "Combo / Spell Control". True multi-card
> combos need persistent cross-turn state, which (a) is a large engine addition and (b) is invisible
> to the greedy bench bot, so it can't be self-play balanced. We delivered the achievable, testable
> half — **Spell Control** via scaling removal — and treat the board-scaling spells as the
> "combo-like" payoff. Real combo state is a candidate for a later pass alongside a smarter bot.

**The Oracle (built):** banks presence with solid bodies, then multiplies it with `buff` cards
(a new card kind). A buff **adds flat presence then amplifies the zone total by 40%** —
deliberately *not* pure-multiply: an early version with no flat component was unplayable (0–5%
win) because buffs are dead when behind and the deck fell behind playing conditional cards. The
flat+amplify form is never dead. Ability **Rally** (free: +2 then +40%, cd 3) is the new
`amplify` ability kind. Engine: a buff phase resolves after units, before the spell snapshot
(so spells can strip buffed presence); bot evaluates buffs via immediate board value. **Anti-snowball
is structural:** a zone scores 1 point for *any* lead, so amplifying a zone you already hold is
worthless — buffs are for *flipping contested zones*. Bench: balanced vs Warden (~56% neutral),
Conjurer (~48–52%), mirror (~47%). **Known follow-up:** Shade hard-counters the Oracle across all
territories (~88–99%) — a no-removal buff deck is structurally prey to removal. It sits in the same
extreme band the committed roster already ships (Warden loses 87% to Shade on Volcanic). Left as the
Oracle's designed bane; revisit when the Mage's spell-control lands or if a removal-hedge is added.

**Engine mechanics now available for reuse:** card kinds `unit` (flat presence) / `spell` (flat
`damage` + `damageFrac` percentage removal, optional `selfPresence` seize) / `buff` (flat
`presence` + `amplify` percentage self-buff); ability kinds `addSelf` / `removeFoe` / `amplify`;
the `allZones` flag works on all of them. A new hero that fits these primitives is **data only**
(`src/heroes.ts` + `src/cards.ts`). A genuinely new mechanic (e.g. cross-turn combo state) extends
the engine *and* the bot first — and must produce immediate board value or the greedy bench bot
can't evaluate it.

**The Conjurer (built):** goes wide — thin presence across all three zones via `allZones`
cards (swarm/conjure/legion), plus single-zone bodies (sprite/golem) to win a contested point.
No removal — a clean weakness vs. tempo/removal decks. Ability **Manifest** (free +4 to a zone,
cd 3). Bench profile: balanced at Neutral (~40% vs Warden, ~51% vs Shade, mirror ~46%); weak on
Volcanic Forge (Shade's amplified removal shreds thin presence); strong on Ancient Forest (wide
units amplified). **Known follow-up for 5b:** Shade-vs-Conjurer on Ancient Forest is ~95% — the
territory's "+1 presence" amplifies `allZones` cards 3×. That's an *Ancient Forest* lever, not a
hero lever; left untouched here to avoid destabilizing the committed Warden/Shade balance. Retune
the territory (not the hero) during the 5b territory pass.

**Build order taken** (cheapest/highest-confidence first — all done):
1. ✅ **Summoner** — pure data; proved the "add a hero" pipeline.
2. ✅ **Support** — added the `buff` card kind + `amplify` ability kind. Lesson: a buff mechanic
   must add *immediate flat board value*, not pure-multiply — both because buffs are
   dead-when-behind, and because the greedy bench bot only values immediate board state.
3. ✅ **Mage** — added `damageFrac` (percentage removal), a clean mirror of `amplify`. Lesson:
   presence-generation (seize) drove the win rate far more than the removal fraction. We delivered
   the **Spell Control** half of "Combo / Spell Control"; true cross-turn combo state is deferred
   (see the note above — it needs an immediate-value framing or a smarter bot).

**Per-hero definition of done:** deck (12 cards, several ≤2-cost), one signature ability,
bot can play it (`src/bot.ts` heuristics cover the new mechanics), and a `sim:bench` balance
pass keeps matchups in ~45–55% (no archetype dominates).

### 5b. Territories — 3 built (1 neutral + 2 real)

| Territory | Rule | Status |
| --- | --- | --- |
| Neutral Field | none | ✅ |
| Volcanic Forge | spells remove +2 | ✅ |
| Ancient Forest | units +1 presence | ✅ |
| _more_ | rules-not-power modifiers | 🔲 add ≥1 to hit the ≥4 target |
| Ancient Forest (retune) | "+1 presence" amplifies `allZones` 3× | ⚠️ **retune** — Conjurer ~95% on Forest |

Each new territory is a `TerritoryDef.modifyCard` in `src/territory.ts` (pure data). Design
targets: modifiers that interact with the archetypes (e.g. a board that rewards buffs, one that
blunts board-wide swings, one that favours removal) so content reinforces content. Keep them
rule-shaped, never +X power in the abstract. **Also retune Ancient Forest** here (its flat "+1 to
units" triples on `allZones` cards — the Conjurer's degenerate Forest matchup; it's a territory
lever, not a hero one).

### 5c. Ability variety — mostly done
Ability kinds grew from 2 to **3** this session: `addSelf`, `removeFoe`, and `amplify` (the
Oracle's Rally). The Magus reused `removeFoe`. `AbilityDef.kind` lives in `src/types.ts`,
resolution in `src/engine.ts`, the client panel in `abilityPanel` (`main.ts`), and the bot in
`bestAbilityZone`. Adding more is optional polish, not blocking — only extend when a future hero
needs a genuinely new effect (and remember: it must produce immediate board value for the bot).

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
