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
};

export function cardDef(id: string): CardDef {
  const c = CARDS[id];
  if (!c) throw new Error(`Unknown card id: ${id}`);
  return c;
}
