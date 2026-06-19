// Card catalog for the prototype. Deliberately tiny — just enough to make the
// two starter archetypes feel distinct and prove the resolution loop is fun.

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

  // --- Tank archetype: Defense / Zone Control (durable, high-presence units) ---
  shieldwall: {
    id: "shieldwall",
    name: "Shieldwall",
    cost: 2,
    kind: "unit",
    presence: 4,
    text: "Add 4 presence to a zone.",
  },
  bulwark: {
    id: "bulwark",
    name: "Bulwark",
    cost: 4,
    kind: "unit",
    presence: 6,
    text: "Add 6 presence to a zone.",
  },
  rampart: {
    id: "rampart",
    name: "Rampart",
    cost: 3,
    kind: "unit",
    presence: 5,
    text: "Add 5 presence to a zone.",
  },

  // --- Assassin archetype: Burst / Tempo (cheap units + presence removal) ---
  skirmisher: {
    id: "skirmisher",
    name: "Skirmisher",
    cost: 1,
    kind: "unit",
    presence: 3,
    text: "Add 3 presence to a zone.",
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
};

export function cardDef(id: string): CardDef {
  const c = CARDS[id];
  if (!c) throw new Error(`Unknown card id: ${id}`);
  return c;
}
