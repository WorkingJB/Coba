// Starter heroes. Per the architecture, a hero IS a deck archetype, not a skin.
// Decks are 12 cards. Each has several cheap (≤2) cards so the opening is rarely
// dead, plus board-wide cards (bastion / volley / swarm) for dynamic swings.
// Roster (5 — the design target from ARCHITECTURE.md §1): Warden (Tank), Shade
// (Assassin), Conjurer (Summoner), Oracle (Support), Magus (Mage).

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
  conjurer: {
    id: "conjurer",
    name: "The Conjurer",
    archetype: "Summon / Board Presence",
    // Goes wide: four allZones cards (swarm/conjure/legion) spread thin presence
    // across all three zones, with sprite/golem as single-zone bodies to actually
    // win a contested point. No removal — a clean weakness vs. tempo decks.
    deck: [
      "recruit", "recruit",
      "swarm", "swarm",
      "sprite", "sprite", "sprite",
      "conjure", "conjure",
      "golem", "golem",
      "legion",
    ],
    ability: {
      id: "manifest",
      name: "Manifest",
      text: "Free: add 4 presence to a zone.",
      kind: "addSelf",
      amount: 4,
      cooldown: 3,
    },
  },
  oracle: {
    id: "oracle",
    name: "The Oracle",
    archetype: "Support / Buffs",
    // Banks presence with solid bodies, then multiplies it with buff cards.
    // No removal and no board-wide bodies — a buff is dead on an empty zone, so
    // the Oracle must invest first, then amplify to flip a contested point.
    deck: [
      "recruit", "recruit",
      "acolyte", "acolyte", "acolyte",
      "bolster", "bolster",
      "empower", "empower",
      "templar", "templar",
      "benediction",
    ],
    ability: {
      id: "rally",
      name: "Rally",
      text: "Free: add 2 presence to a zone, then increase your presence there by 40%.",
      kind: "amplify",
      amplify: 0.4,
      amount: 2, // flat reinforce applied before the % buff
      cooldown: 3,
    },
  },
  magus: {
    id: "magus",
    name: "The Magus",
    archetype: "Arcane / Spell Control",
    // Percentage removal: the counter to BIG presence. Light on bodies, so its
    // spells seize (plant presence) to actually take zones, not just deny them.
    // `disjunction` strips half of every zone — board-wide control.
    deck: [
      "apprentice", "apprentice",
      "arcane_bolt", "arcane_bolt",
      "unravel", "unravel",
      "construct", "construct",
      "arcane_blast", "arcane_blast",
      "disjunction", "disjunction",
    ],
    ability: {
      id: "nullify",
      name: "Nullify",
      text: "Free: remove 3 enemy presence from a zone, then add 1 of your own.",
      kind: "removeFoe",
      amount: 3,
      selfPlant: 1,
      cooldown: 3,
    },
  },
};

export function heroDef(id: string): HeroDef {
  const h = HEROES[id];
  if (!h) throw new Error(`Unknown hero id: ${id}`);
  return h;
}

export const HERO_IDS = Object.keys(HEROES);
