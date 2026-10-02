// The pure rules engine. NO rendering, NO networking — just state in, state out.
// This is the artifact Build Sequence step 1 exists to validate: prove the loop
// is fun here (in text) before Phaser or Colyseus touch it. The same module is
// intended to run client-side (prediction) and server-side (authority).

import {
  type GameState,
  type PlannedAction,
  type PlayerId,
  type PlayerState,
  type MatchResult,
  type CardDef,
  type ZoneId,
  ZONE_IDS,
  PLAYER_IDS,
  opponentOf,
} from "./types.js";
import { cardDef } from "./cards.js";
import { heroDef } from "./heroes.js";
import { territoryDef } from "./territory.js";
import { type Rng, shuffle } from "./rng.js";

const ENERGY_CAP = 8;
const STARTING_ENERGY = 1;
const OPENING_HAND = 3;
const DEFAULT_POINTS_TO_WIN = 12;
const DEFAULT_MAX_TURNS = 25;
// Presence decay lever (1 = pure accumulation, no decay). Tested at 0.6 and it
// made the imbalance WORSE — decay erodes the Shade's small bodies faster than
// the Warden's big walls, which simply re-stack. Left off; kept as a tunable.
const PRESENCE_RETAINED = 1;

export interface InitOptions {
  p1HeroId: string;
  p2HeroId: string;
  territoryId?: string;
  pointsToWin?: number;
  maxTurns?: number;
  rng: Rng;
}

function makePlayer(id: PlayerId, heroId: string, rng: Rng): PlayerState {
  const deck = shuffle(heroDef(heroId).deck, rng);
  const hand = deck.slice(0, OPENING_HAND);
  const draw = deck.slice(OPENING_HAND);

  // Guarantee a non-dead first turn: ensure the opening hand holds at least one
  // card castable on turn 1, swapping the priciest hand card for a cheap one from
  // the draw pile if needed. (Playtest: the Warden could be stuck passing turn 1.)
  if (!hand.some((c) => cardDef(c).cost <= STARTING_ENERGY)) {
    const cheapInDraw = draw.findIndex((c) => cardDef(c).cost <= STARTING_ENERGY);
    if (cheapInDraw !== -1) {
      let priciest = 0;
      for (let i = 1; i < hand.length; i++) {
        if (cardDef(hand[i]!).cost > cardDef(hand[priciest]!).cost) priciest = i;
      }
      [hand[priciest], draw[cheapInDraw]] = [draw[cheapInDraw]!, hand[priciest]!];
    }
  }

  return {
    id,
    heroId,
    energy: STARTING_ENERGY,
    energyCap: STARTING_ENERGY,
    hand,
    draw,
    discard: [],
    points: 0,
    abilityReady: 0, // ready from turn 1
  };
}

export function initGame(opts: InitOptions): GameState {
  const territoryId = opts.territoryId ?? "neutral_field";
  const zones = Object.fromEntries(
    ZONE_IDS.map((z) => [z, { id: z, presence: { P1: 0, P2: 0 } }]),
  ) as GameState["zones"];

  return {
    turn: 1,
    zones,
    players: {
      P1: makePlayer("P1", opts.p1HeroId, opts.rng),
      P2: makePlayer("P2", opts.p2HeroId, opts.rng),
    },
    territoryId,
    pointsToWin: opts.pointsToWin ?? DEFAULT_POINTS_TO_WIN,
    maxTurns: opts.maxTurns ?? DEFAULT_MAX_TURNS,
    log: [`Battlefield: ${territoryDef(territoryId).name} — ${territoryDef(territoryId).describe}`],
  };
}

/** Deep-ish clone sufficient for our plain-data state. */
function clone(state: GameState): GameState {
  return structuredClone(state);
}

function drawOne(p: PlayerState, rng: Rng): void {
  if (p.draw.length === 0) {
    if (p.discard.length === 0) return; // nothing to draw; deck fully in hand/board
    p.draw = shuffle(p.discard, rng);
    p.discard = [];
  }
  const card = p.draw.shift();
  if (card) p.hand.push(card);
}

/** Every legal (card, zone) commitment for a player at the current state. */
export function legalActions(state: GameState, player: PlayerId): PlannedAction[] {
  const p = state.players[player];
  const actions: PlannedAction[] = [{ player, cardId: null, zone: null }]; // passing is always legal
  const seen = new Set<string>();
  for (const cardId of p.hand) {
    if (seen.has(cardId)) continue;
    seen.add(cardId);
    if (cardDef(cardId).cost > p.energy) continue;
    for (const zone of ZONE_IDS) actions.push({ player, cardId, zone });
  }
  return actions;
}

interface ResolvedPlay {
  player: PlayerId;
  card: CardDef; // territory-modified
  zone: ZoneId;
}

/**
 * Validate and pay for one committed action. Returns the territory-modified card
 * + target zone, or null for a pass / illegal play (logged). Does NOT apply the
 * board effect — resolveTurn applies effects in ordered, simultaneous phases.
 */
function consumeCard(state: GameState, action: PlannedAction): ResolvedPlay | null {
  const { player, cardId, zone } = action;
  const p = state.players[player];

  if (cardId === null || zone === null) {
    return null; // plain pass — resolveTurn logs it only if no ability fires either
  }
  const idx = p.hand.indexOf(cardId);
  if (idx === -1) {
    state.log.push(`  ${player} tried to play ${cardId} but it isn't in hand — pass.`);
    return null;
  }
  const base = cardDef(cardId);
  if (base.cost > p.energy) {
    state.log.push(`  ${player} can't afford ${base.name} — pass.`);
    return null;
  }

  // Pay + move card to discard.
  p.energy -= base.cost;
  p.hand.splice(idx, 1);
  p.discard.push(cardId);

  // Territory rewrites the card as it resolves.
  return { player, card: territoryDef(state.territoryId).modifyCard(base), zone };
}

function controllerOf(state: GameState, zone: ZoneId): PlayerId | null {
  const { P1, P2 } = state.zones[zone].presence;
  if (P1 > P2) return "P1";
  if (P2 > P1) return "P2";
  return null; // tie = contested, no one scores
}

/**
 * Resolve one full turn from both players' locked actions.
 * Order: units deploy first (both players), then spells resolve (both players),
 * so a spell can answer a unit committed the same turn. Then zones score and
 * the next turn is prepared (energy ramp + draw).
 */
export function resolveTurn(
  state: GameState,
  actions: [PlannedAction, PlannedAction],
  rng: Rng,
): GameState {
  const s = clone(state);
  s.log.push(`— Turn ${s.turn} —`);

  const ordered = PLAYER_IDS.map((pid) => actions.find((a) => a.player === pid)!);
  const plays = ordered
    .map((a) => consumeCard(s, a))
    .filter((r): r is ResolvedPlay => r !== null);

  // Phase 1 — units deploy. Additive, so resolution order is irrelevant.
  for (const r of plays) {
    if (r.card.kind !== "unit") continue;
    const add = r.card.presence ?? 0;
    if (r.card.allZones) {
      for (const z of ZONE_IDS) s.zones[z].presence[r.player] += add;
      s.log.push(`  ${r.player} plays ${r.card.name} → ALL zones (+${add} each).`);
    } else {
      s.zones[r.zone].presence[r.player] += add;
      s.log.push(`  ${r.player} plays ${r.card.name} → ${r.zone} (+${add} presence).`);
    }
  }

  // Phase 1b — buffs reinforce then amplify the caster's own presence. They add
  // flat `presence` first (so a buff is never dead on an empty zone — the fix for
  // the Support death-spiral) and THEN scale the result by `amplify`, rewarding a
  // base built on prior turns. Each player reads only their own presence, so the
  // order between the two players is irrelevant.
  for (const r of plays) {
    if (r.card.kind !== "buff") continue;
    const flat = r.card.presence ?? 0;
    const factor = r.card.amplify ?? 0;
    const targets = r.card.allZones ? ZONE_IDS : [r.zone];
    let addedTotal = 0;
    for (const z of targets) {
      const before = s.zones[z].presence[r.player];
      const after = before + flat;
      const amplified = after + Math.floor(after * factor);
      s.zones[z].presence[r.player] = amplified;
      addedTotal += amplified - before;
    }
    const where = r.card.allZones ? "ALL zones" : r.zone;
    s.log.push(`  ${r.player} plays ${r.card.name} → ${where} (+${addedTotal} presence; +${flat} then +${Math.round(factor * 100)}%).`);
  }

  // Phase 2 — spells resolve SIMULTANEOUSLY. Every removal is computed against a
  // snapshot taken AFTER units deploy but BEFORE any spell, so neither player can
  // react to the other's same-turn spell. (A live read here gave P2 a hidden
  // second-mover edge: it removed the presence P1 had just planted.)
  const snapshot = {} as Record<ZoneId, Record<PlayerId, number>>;
  for (const z of ZONE_IDS) {
    snapshot[z] = { P1: s.zones[z].presence.P1, P2: s.zones[z].presence.P2 };
  }
  for (const r of plays) {
    if (r.card.kind !== "spell") continue;
    const foe = opponentOf(r.player);
    const planted = r.card.selfPresence ?? 0;
    const targets = r.card.allZones ? ZONE_IDS : [r.zone];
    let removedTotal = 0;
    for (const z of targets) {
      // Flat removal + a fraction of what's there (the Mage's anti-stack control).
      // Both read the post-unit snapshot, so neither reacts to a same-turn spell.
      const want = (r.card.damage ?? 0) + Math.floor(snapshot[z][foe] * (r.card.damageFrac ?? 0));
      const removed = Math.min(snapshot[z][foe], want);
      s.zones[z].presence[foe] = Math.max(0, s.zones[z].presence[foe] - removed);
      s.zones[z].presence[r.player] += planted;
      removedTotal += removed;
    }
    const seize = planted > 0 ? `, +${planted} own${r.card.allZones ? " each" : ""}` : "";
    const where = r.card.allZones ? "ALL zones" : r.zone;
    s.log.push(`  ${r.player} casts ${r.card.name} → ${where} (−${removedTotal} enemy${seize}).`);
  }

  // Phase 3 — hero abilities (free, cooldown-gated). Snapshot again so removals
  // resolve simultaneously; additive effects are order-independent regardless.
  const abilitySnap = {} as Record<ZoneId, Record<PlayerId, number>>;
  for (const z of ZONE_IDS) {
    abilitySnap[z] = { P1: s.zones[z].presence.P1, P2: s.zones[z].presence.P2 };
  }
  for (const a of ordered) {
    if (!a.ability) continue;
    const p = s.players[a.player];
    const ability = heroDef(p.heroId).ability;
    if (p.abilityReady > 0) {
      s.log.push(`  ${a.player}'s ${ability.name} isn't ready — skipped.`);
      continue;
    }
    if (ability.kind === "addSelf") {
      s.zones[a.ability].presence[a.player] += ability.amount;
      s.log.push(`  ${a.player} uses ${ability.name} → ${a.ability} (+${ability.amount} presence).`);
    } else if (ability.kind === "amplify") {
      const factor = ability.amplify ?? 0;
      const before = s.zones[a.ability].presence[a.player];
      const after = before + ability.amount; // flat reinforce, then amplify
      s.zones[a.ability].presence[a.player] = after + Math.floor(after * factor);
      const add = s.zones[a.ability].presence[a.player] - before;
      s.log.push(`  ${a.player} uses ${ability.name} → ${a.ability} (+${add} presence; +${ability.amount} then +${Math.round(factor * 100)}%).`);
    } else {
      const foe = opponentOf(a.player);
      const removed = Math.min(abilitySnap[a.ability][foe], ability.amount);
      s.zones[a.ability].presence[foe] = Math.max(0, s.zones[a.ability].presence[foe] - removed);
      const planted = ability.selfPlant ?? 0;
      s.zones[a.ability].presence[a.player] += planted;
      const seize = planted > 0 ? `, +${planted} own` : "";
      s.log.push(`  ${a.player} uses ${ability.name} → ${a.ability} (−${removed} enemy${seize}).`);
    }
    p.abilityReady = ability.cooldown;
  }

  // Anyone who neither played a card nor fired an ability simply passed.
  for (const a of ordered) {
    if (a.cardId === null && !a.ability) s.log.push(`  ${a.player} passes.`);
  }

  // Score zones.
  for (const zone of ZONE_IDS) {
    const ctrl = controllerOf(s, zone);
    if (ctrl) {
      s.players[ctrl].points += 1;
      s.log.push(`  ${ctrl} controls ${zone} (+1 point).`);
    } else {
      s.log.push(`  ${zone} contested — no points.`);
    }
  }
  s.log.push(`  Score → P1: ${s.players.P1.points}, P2: ${s.players.P2.points}`);

  // Decay standing presence so walls erode and tempo/removal stay relevant.
  if (PRESENCE_RETAINED < 1) {
    for (const zone of ZONE_IDS) {
      for (const pid of PLAYER_IDS) {
        s.zones[zone].presence[pid] = Math.floor(
          s.zones[zone].presence[pid] * PRESENCE_RETAINED,
        );
      }
    }
  }

  // Prepare next turn: ramp energy and draw.
  s.turn += 1;
  for (const pid of PLAYER_IDS) {
    const p = s.players[pid];
    p.energyCap = Math.min(ENERGY_CAP, p.energyCap + 1);
    p.energy = p.energyCap;
    p.abilityReady = Math.max(0, p.abilityReady - 1);
    drawOne(p, rng);
  }

  return s;
}

export function checkWinCondition(state: GameState): MatchResult | null {
  const p1 = state.players.P1.points;
  const p2 = state.players.P2.points;
  const finalPoints = { P1: p1, P2: p2 };

  const reachedTarget = p1 >= state.pointsToWin || p2 >= state.pointsToWin;
  const hitCap = state.turn > state.maxTurns;
  if (!reachedTarget && !hitCap) return null;

  const turns = state.turn - 1;
  if (p1 === p2) return { winner: "DRAW", reason: reachedTarget ? "points" : "turn-cap", turns, finalPoints };
  return {
    winner: p1 > p2 ? "P1" : "P2",
    reason: reachedTarget ? "points" : "turn-cap",
    turns,
    finalPoints,
  };
}
