// Card catalog. Expanded from the first tiny set after playtest feedback that
// "card selection feels very small." Each archetype now has a real curve with
// cheap early plays (so turn 1 isn't dead) plus a board-wide card for swing.

import type { CardDef } from "./types.js";

export const CARDS: Record<string, CardDef> = {
  // --- Generic / shared ---
  recruit: {
    id: "recruit",
    name: "Recruit",
    cost: 1,
    kind: "unit",
    presence: 2,
    text: "Add 2 presence to a zone.",
  },

  // --- Tank archetype: Defense / Zone Control (durable, high-presence, board-wide) ---
  shieldwall: {
    id: "shieldwall",
    name: "Shieldwall",
    cost: 2,
    kind: "unit",
    presence: 4,
    text: "Add 4 presence to a zone.",
  },
  rampart: {
    id: "rampart",
    name: "Rampart",
    cost: 3,
    kind: "unit",
    presence: 5,
    text: "Add 5 presence to a zone.",
  },
  bulwark: {
    id: "bulwark",
    name: "Bulwark",
    cost: 4,
    kind: "unit",
    presence: 6,
    text: "Add 6 presence to a zone.",
  },
  garrison: {
    id: "garrison",
    name: "Garrison",
    cost: 5,
    kind: "unit",
    presence: 8,
    text: "Add 8 presence to a zone.",
  },
  bastion: {
    id: "bastion",
    name: "Bastion",
    cost: 3,
    kind: "unit",
    presence: 2,
    allZones: true,
    text: "Add 2 presence to EVERY zone.",
  },

  // --- Assassin archetype: Burst / Tempo (cheap units, removal that seizes, board-wide) ---
  skirmisher: {
    id: "skirmisher",
    name: "Skirmisher",
    cost: 1,
    kind: "unit",
    presence: 3,
    text: "Add 3 presence to a zone.",
  },
  dagger: {
    id: "dagger",
    name: "Dagger",
    cost: 1,
    kind: "spell",
    damage: 2,
    selfPresence: 1,
    text: "Remove 2 enemy presence, then add 1 of your own.",
  },
  ambush: {
    id: "ambush",
    name: "Ambush",
    cost: 2,
    kind: "spell",
    damage: 4,
    selfPresence: 1,
    text: "Remove 4 enemy presence, then add 1 of your own.",
  },
  assassinate: {
    id: "assassinate",
    name: "Assassinate",
    cost: 3,
    kind: "spell",
    damage: 6,
    selfPresence: 2,
    text: "Remove 6 enemy presence, then add 2 of your own.",
  },
  volley: {
    id: "volley",
    name: "Volley",
    cost: 3,
    kind: "spell",
    damage: 2,
    selfPresence: 1,
    allZones: true,
    text: "Remove 2 enemy presence and add 1 of your own in EVERY zone.",
  },

  // --- Summoner archetype: Board Presence (goes WIDE — thin presence across all
  // three zones, plus single-zone bodies to win a contested point). Trades
  // per-zone strength for board coverage; vulnerable to concentrated removal.
  // Stat points reuse the engine's already-balanced values to limit balance risk;
  // the identity is the allZones-heavy MIX, not new numbers. ---
  swarm: {
    id: "swarm",
    name: "Swarm",
    cost: 2,
    kind: "unit",
    presence: 1,
    allZones: true,
    text: "Add 1 presence to EVERY zone.",
  },
  sprite: {
    id: "sprite",
    name: "Sprite",
    cost: 2,
    kind: "unit",
    presence: 4,
    text: "Add 4 presence to a zone.",
  },
  conjure: {
    id: "conjure",
    name: "Conjure",
    cost: 3,
    kind: "unit",
    presence: 2,
    allZones: true,
    text: "Add 2 presence to EVERY zone.",
  },
  golem: {
    id: "golem",
    name: "Golem",
    cost: 4,
    kind: "unit",
    presence: 6,
    text: "Add 6 presence to a zone.",
  },
  legion: {
    id: "legion",
    name: "Legion",
    cost: 5,
    kind: "unit",
    presence: 3,
    allZones: true,
    text: "Add 3 presence to EVERY zone.",
  },

  // --- Support archetype: Buffs / Healing (a force multiplier). Solid bodies to
  // bank presence, then `buff` cards amplify it — strong when concentrated,
  // dead on an empty zone. Because a zone scores 1 point for ANY lead, buffs are
  // for FLIPPING contested zones, not padding ones you already hold. ---
  acolyte: {
    id: "acolyte",
    name: "Acolyte",
    cost: 2,
    kind: "unit",
    presence: 3,
    text: "Add 3 presence to a zone.",
  },
  templar: {
    id: "templar",
    name: "Templar",
    cost: 4,
    kind: "unit",
    presence: 6,
    text: "Add 6 presence to a zone.",
  },
  bolster: {
    id: "bolster",
    name: "Bolster",
    cost: 2,
    kind: "buff",
    presence: 2,
    amplify: 0.4,
    text: "Add 2 presence to a zone, then increase your presence there by 40%.",
  },
  empower: {
    id: "empower",
    name: "Empower",
    cost: 3,
    kind: "buff",
    presence: 3,
    amplify: 0.4,
    text: "Add 3 presence to a zone, then increase your presence there by 40%.",
  },
  benediction: {
    id: "benediction",
    name: "Benediction",
    cost: 4,
    kind: "buff",
    presence: 1,
    amplify: 0.4,
    allZones: true,
    text: "Add 1 presence to EVERY zone, then increase your presence there by 40%.",
  },

  // --- Mage archetype: Spell Control (percentage removal — the answer to BIG
  // presence). Flat removal (the Shade) whiffs against huge walls/buffed stacks;
  // the Mage strips a FRACTION, so the bigger the stack the more it takes, plus
  // board-wide reach. Light on bodies, so it must seize (selfPresence) to hold. ---
  apprentice: {
    id: "apprentice",
    name: "Apprentice",
    cost: 1,
    kind: "unit",
    presence: 2,
    text: "Add 2 presence to a zone.",
  },
  construct: {
    id: "construct",
    name: "Arcane Construct",
    cost: 3,
    kind: "unit",
    presence: 5,
    text: "Add 5 presence to a zone.",
  },
  arcane_bolt: {
    id: "arcane_bolt",
    name: "Arcane Bolt",
    cost: 2,
    kind: "spell",
    damage: 3,
    selfPresence: 1,
    text: "Remove 3 enemy presence, then add 1 of your own.",
  },
  unravel: {
    id: "unravel",
    name: "Unravel",
    cost: 2,
    kind: "spell",
    damageFrac: 0.4,
    selfPresence: 1,
    text: "Remove 40% of the enemy's presence in a zone, then add 1 of your own.",
  },
  arcane_blast: {
    id: "arcane_blast",
    name: "Arcane Blast",
    cost: 4,
    kind: "spell",
    damage: 5,
    selfPresence: 2,
    text: "Remove 5 enemy presence, then add 2 of your own.",
  },
  disjunction: {
    id: "disjunction",
    name: "Disjunction",
    cost: 4,
    kind: "spell",
    damageFrac: 0.4,
    selfPresence: 1,
    allZones: true,
    text: "Remove 40% of the enemy's presence in EVERY zone, then add 1 of your own each.",
  },
};

export function cardDef(id: string): CardDef {
  const c = CARDS[id];
  if (!c) throw new Error(`Unknown card id: ${id}`);
  return c;
}
