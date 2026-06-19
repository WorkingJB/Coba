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
  return { id, heroId, energy: 1, energyCap: 1, hand, draw, discard: [], points: 0 };
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
    state.log.push(`  ${player} passes.`);
    return null;
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
    s.zones[r.zone].presence[r.player] += add;
    s.log.push(`  ${r.player} plays ${r.card.name} → ${r.zone} (+${add} presence).`);
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
    const removed = Math.min(snapshot[r.zone][foe], r.card.damage ?? 0);
    s.zones[r.zone].presence[foe] = Math.max(0, s.zones[r.zone].presence[foe] - removed);
    const planted = r.card.selfPresence ?? 0;
    s.zones[r.zone].presence[r.player] += planted;
    const seize = planted > 0 ? `, +${planted} own` : "";
    s.log.push(`  ${r.player} casts ${r.card.name} → ${r.zone} (−${removed} enemy${seize}).`);
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
