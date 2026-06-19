// Domain types for the Cardito card-resolution engine.
// Prototype scope: 1v1, three control points, simultaneous-turn resolution.
// Heroes are deck archetypes; territory alters rules, never raw power.

export type PlayerId = "P1" | "P2";
export type ZoneId = "LEFT" | "CORE" | "RIGHT";

export const ZONE_IDS: ZoneId[] = ["LEFT", "CORE", "RIGHT"];
export const PLAYER_IDS: PlayerId[] = ["P1", "P2"];

export function opponentOf(p: PlayerId): PlayerId {
  return p === "P1" ? "P2" : "P1";
}

/** A card definition. `unit` adds presence to a zone; `spell` removes enemy presence. */
export interface CardDef {
  id: string;
  name: string;
  /** Energy cost to play. */
  cost: number;
  kind: "unit" | "spell";
  /** Units: presence contributed to the target zone. */
  presence?: number;
  /** Spells: presence removed from the opponent in the target zone. */
  damage?: number;
  /** Spells: presence the caster also plants in the zone (lets removal TAKE ground, not just deny). */
  selfPresence?: number;
  /** If true, the card's effect applies to ALL zones at once (board-wide swing). Target zone is ignored. */
  allZones?: boolean;
  text: string;
}

/** A free, cooldown-gated signature move that does things cards can't. */
export interface AbilityDef {
  id: string;
  name: string;
  text: string;
  /** `addSelf` plants the caster's presence; `removeFoe` strips the opponent's. */
  kind: "addSelf" | "removeFoe";
  amount: number;
  /** For `removeFoe`: presence the caster also plants (lets the strike TAKE ground, not just deny). */
  selfPlant?: number;
  /** Turns before it can be used again after firing. */
  cooldown: number;
}

/** A hero is a deck archetype: an identity, a fixed deck, and a signature ability. */
export interface HeroDef {
  id: string;
  name: string;
  /** Short archetype label, e.g. "Defense / Zone Control". */
  archetype: string;
  /** Card ids that make up the starting deck (drawn in order, reshuffled when empty). */
  deck: string[];
  ability: AbilityDef;
}

/** A single control point. Whoever has strictly greater presence controls it. */
export interface Zone {
  id: ZoneId;
  presence: Record<PlayerId, number>;
}

export interface PlayerState {
  id: PlayerId;
  heroId: string;
  energy: number;
  energyCap: number;
  /** Card ids currently holdable / playable. */
  hand: string[];
  /** Draw pile (front of array drawn first). */
  draw: string[];
  /** Cards already played, recycled into draw when the pile empties. */
  discard: string[];
  /** Victory points accrued from holding zones. */
  points: number;
  /** Turns until the hero ability can be used again (0 = ready now). */
  abilityReady: number;
}

export interface GameState {
  turn: number;
  zones: Record<ZoneId, Zone>;
  players: Record<PlayerId, PlayerState>;
  /** Active battlefield modifier id (see territory.ts). */
  territoryId: string;
  /** Points needed to win the match. */
  pointsToWin: number;
  /** Hard turn cap; highest points wins if reached. */
  maxTurns: number;
  log: string[];
}

/** What a player commits during the simultaneous planning phase. */
export interface PlannedAction {
  player: PlayerId;
  /** Card id to play, or null to pass. */
  cardId: string | null;
  /** Target zone for the card, or null when passing. */
  zone: ZoneId | null;
  /** Zone to fire the hero ability at this turn, or null/undefined to not use it. */
  ability?: ZoneId | null;
}

export interface MatchResult {
  winner: PlayerId | "DRAW";
  reason: "points" | "turn-cap";
  turns: number;
  finalPoints: Record<PlayerId, number>;
}
