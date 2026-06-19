// Two starter heroes. Per the architecture, a hero IS a deck archetype, not a
// skin — unlocking a hero unlocks a way to play. Decks are 12 cards for the
// prototype (kept small so games cycle and stay readable).

import type { HeroDef } from "./types.js";

export const HEROES: Record<string, HeroDef> = {
  warden: {
    id: "warden",
    name: "The Warden",
    archetype: "Defense / Zone Control",
    deck: [
      "recruit", "recruit",
      "shieldwall", "shieldwall", "shieldwall",
      "rampart", "rampart", "rampart",
      "bulwark", "bulwark", "bulwark",
      "recruit",
    ],
  },
  shade: {
    id: "shade",
    name: "The Shade",
    archetype: "Burst / Tempo",
    deck: [
      "skirmisher", "skirmisher", "skirmisher",
      "skirmisher", "skirmisher", "skirmisher",
      "recruit",
      "ambush", "ambush", "ambush",
      "assassinate", "assassinate",
    ],
  },
};

export function heroDef(id: string): HeroDef {
  const h = HEROES[id];
  if (!h) throw new Error(`Unknown hero id: ${id}`);
  return h;
}
