// Two starter heroes. Per the architecture, a hero IS a deck archetype, not a
// skin. Decks are 12 cards. Each has several cheap (≤2) cards so the opening is
// rarely dead, plus a board-wide card (bastion / volley) for dynamic swings.

import type { HeroDef } from "./types.js";

export const HEROES: Record<string, HeroDef> = {
  warden: {
    id: "warden",
    name: "The Warden",
    archetype: "Defense / Zone Control",
    deck: [
      "recruit", "recruit",
      "shieldwall", "shieldwall", "shieldwall",
      "rampart", "rampart",
      "bulwark", "bulwark",
      "garrison",
      "bastion", "bastion",
    ],
    ability: {
      id: "entrench",
      name: "Entrench",
      text: "Free: add 5 presence to a zone.",
      kind: "addSelf",
      amount: 5,
      cooldown: 4,
    },
  },
  shade: {
    id: "shade",
    name: "The Shade",
    archetype: "Burst / Tempo",
    deck: [
      "skirmisher", "skirmisher", "skirmisher", "skirmisher",
      "recruit",
      "dagger", "dagger",
      "ambush", "ambush",
      "assassinate", "assassinate",
      "volley",
    ],
    ability: {
      id: "eviscerate",
      name: "Eviscerate",
      text: "Free: remove 4 enemy presence from a zone, then add 2 of your own.",
      kind: "removeFoe",
      amount: 4,
      selfPlant: 2,
      cooldown: 4,
    },
  },
};

export function heroDef(id: string): HeroDef {
  const h = HEROES[id];
  if (!h) throw new Error(`Unknown hero id: ${id}`);
  return h;
}

export const HERO_IDS = Object.keys(HEROES);
