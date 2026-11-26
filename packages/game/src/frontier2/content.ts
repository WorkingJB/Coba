// frontier-2 content. Everything here is data: a new card, commander or theater
// that fits the Effect vocabulary needs no engine change. Released rulesets are
// immutable; frontier-1 stays in ../content.ts for the matches that use it.
export const RULESET = "frontier-2" as const;
export const ZONES = ["The Drydock", "The Spindle", "The Relay"] as const;

/** What a card or ability does in its zone. Fields combine; all are optional. */
export interface Effect {
  /** Presence established for your team. */
  add?: number;
  /** Flat enemy presence removed. */
  damage?: number;
  /** Fraction of enemy presence removed (0.4 = 40%), measured after deployments. */
  damageFrac?: number;
  /** Presence your team deploys in the zone this turn arrives this much stronger (0.5 = +50%). */
  amplify?: number;
  /** Removal blocked in this zone this turn. */
  shield?: number;
  /** Extra removal where the enemy deployed a unit this turn. */
  ambush?: number;
  /** Applies to every zone; the chosen zone is ignored. */
  all?: boolean;
}
export type CardType = "unit" | "strike" | "support";
export interface Card extends Effect {
  name: string;
  cost: number;
  type: CardType;
}

export const CARDS = {
  // Shared hulls: the plain presence curve every commander draws on.
  marines: { name: "Marine Squad", cost: 1, type: "unit", add: 2 },
  gunship: { name: "Gunship", cost: 2, type: "unit", add: 4 },
  frigate: { name: "Line Frigate", cost: 3, type: "unit", add: 6 },
  cruiser: { name: "Heavy Cruiser", cost: 4, type: "unit", add: 8 },
  dreadnought: { name: "Dreadnought", cost: 5, type: "unit", add: 11 },

  // Marshal: fortification. Shields make strikes whiff.
  hardpoint: { name: "Hardpoint", cost: 2, type: "unit", add: 3, shield: 3 },
  pdgrid: {
    name: "Point-Defense Grid",
    cost: 3,
    type: "support",
    add: 4,
    shield: 6,
  },
  cordon: { name: "Fleet Cordon", cost: 3, type: "unit", add: 2, all: true },

  // Corsair: strikes that seize ground and punish predictable reinforcement.
  sabotage: { name: "Sabotage", cost: 1, type: "strike", damage: 1, add: 1 },
  boarding: {
    name: "Boarding Action",
    cost: 2,
    type: "strike",
    damage: 2,
    add: 1,
    ambush: 2,
  },
  torpedo: { name: "Torpedo Run", cost: 3, type: "strike", damage: 4, add: 2 },
  broadside: {
    name: "Broadside",
    cost: 3,
    type: "strike",
    damage: 1,
    add: 1,
    all: true,
  },

  // Swarmwright: thin presence everywhere.
  drones: { name: "Drone Cloud", cost: 2, type: "unit", add: 1, all: true },
  flotilla: { name: "Drone Flotilla", cost: 3, type: "unit", add: 2, all: true },
  armada: { name: "Swarm Armada", cost: 5, type: "unit", add: 4, all: true },

  // Quartermaster: logistics multiply whatever the team deploys alongside them.
  resupply: {
    name: "Resupply",
    cost: 2,
    type: "support",
    add: 2,
    amplify: 0.5,
  },
  overclock: {
    name: "Overclock",
    cost: 3,
    type: "support",
    add: 2,
    amplify: 1,
  },
  mobilize: {
    name: "General Mobilization",
    cost: 4,
    type: "support",
    add: 1,
    amplify: 0.5,
    all: true,
  },

  // Signalist: electronic warfare strips a share of whatever is massed.
  jam: { name: "Jamming Burst", cost: 2, type: "strike", damage: 3, add: 1 },
  spoof: { name: "Spoof", cost: 2, type: "strike", damageFrac: 0.3, add: 1 },
  emp: { name: "EMP Lance", cost: 4, type: "strike", damage: 6, add: 2 },
  blackout: {
    name: "Blackout",
    cost: 4,
    type: "strike",
    damageFrac: 0.3,
    add: 1,
    all: true,
  },

  // Blockader: flat attrition across the whole front.
  embargo: { name: "Embargo", cost: 2, type: "strike", damage: 1, all: true },
  interdict: {
    name: "Interdiction",
    cost: 3,
    type: "strike",
    damage: 2,
    all: true,
  },
  siege: { name: "Siege Battery", cost: 3, type: "strike", damage: 4, add: 2 },
  blockade: {
    name: "Total Blockade",
    cost: 5,
    type: "strike",
    damage: 3,
    add: 1,
    all: true,
  },
} satisfies Record<string, Card>;
export type CardId = keyof typeof CARDS;
export const CARD_IDS = Object.keys(CARDS) as CardId[];
export function card(id: CardId): Card {
  return CARDS[id];
}

export interface Ability extends Effect {
  name: string;
  /** Turns before it can fire again. */
  cooldown: number;
}
export interface HeroDef {
  name: string;
  role: string;
  description: string;
  ability: Ability;
  deck: readonly CardId[];
}
export const HEROES = {
  marshal: {
    name: "The Marshal",
    role: "Fortify and hold",
    description: "Heavy hulls behind shields. Make every strike a wasted one.",
    ability: { name: "Dig In", add: 3, shield: 3, cooldown: 3 },
    deck: [
      "marines",
      "marines",
      "hardpoint",
      "hardpoint",
      "gunship",
      "pdgrid",
      "frigate",
      "frigate",
      "cruiser",
      "dreadnought",
      "cordon",
      "cordon",
    ],
  },
  corsair: {
    name: "The Corsair",
    role: "Raid and seize",
    description: "Cheap strikes that take ground. Hit where they reinforce.",
    ability: { name: "Hit and Run", damage: 3, add: 1, ambush: 2, cooldown: 3 },
    deck: [
      "marines",
      "marines",
      "marines",
      "sabotage",
      "sabotage",
      "boarding",
      "boarding",
      "gunship",
      "gunship",
      "torpedo",
      "torpedo",
      "broadside",
    ],
  },
  swarmwright: {
    name: "The Swarmwright",
    role: "Be everywhere",
    description: "Drone swarms spread thin across the whole front.",
    ability: { name: "Fabricate", add: 4, cooldown: 3 },
    deck: [
      "marines",
      "marines",
      "drones",
      "drones",
      "gunship",
      "gunship",
      "gunship",
      "flotilla",
      "flotilla",
      "cruiser",
      "cruiser",
      "armada",
    ],
  },
  quartermaster: {
    name: "The Quartermaster",
    role: "Multiply the line",
    description: "Supplies make every hull that lands beside them hit harder.",
    ability: { name: "Surge", add: 2, amplify: 0.5, cooldown: 3 },
    deck: [
      "marines",
      "marines",
      "gunship",
      "gunship",
      "gunship",
      "resupply",
      "resupply",
      "overclock",
      "overclock",
      "cruiser",
      "cruiser",
      "mobilize",
    ],
  },
  signalist: {
    name: "The Signalist",
    role: "Unmake their mass",
    description: "The bigger the fleet, the more a blackout takes from it.",
    ability: { name: "Scramble", damage: 3, add: 1, cooldown: 3 },
    deck: [
      "marines",
      "marines",
      "jam",
      "jam",
      "spoof",
      "spoof",
      "frigate",
      "frigate",
      "cruiser",
      "emp",
      "emp",
      "blackout",
    ],
  },
  blockader: {
    name: "The Blockader",
    role: "Starve the front",
    description: "Grind a little off every zone, every turn.",
    ability: { name: "Attrit", damage: 2, all: true, cooldown: 4 },
    deck: [
      "marines",
      "marines",
      "embargo",
      "embargo",
      "interdict",
      "interdict",
      "siege",
      "siege",
      "cruiser",
      "cruiser",
      "cruiser",
      "blockade",
    ],
  },
} satisfies Record<string, HeroDef>;
export type Hero = keyof typeof HEROES;
export const HERO_IDS = Object.keys(HEROES) as Hero[];
export function hero(id: Hero): HeroDef {
  return HEROES[id];
}

/** A theater bends how effects resolve. It never changes costs or decks. */
export interface Theater {
  name: string;
  rule: string;
  modify(effect: Effect, type: CardType | "ability"): Effect;
}
export const THEATERS = {
  reach: {
    name: "Kestrel Reach",
    rule: "Open vacuum. Everything resolves at face value.",
    modify: (effect) => effect,
  },
  foundry: {
    name: "Helion Foundry",
    rule: "Focused strikes remove 1 more. Front-wide strikes are unchanged.",
    modify: (effect, type) =>
      type === "strike" && !effect.all && effect.damage
        ? { ...effect, damage: effect.damage + 1 }
        : effect,
  },
  yards: {
    name: "The Graving Yards",
    rule: "Focused units establish 1 more. Front-wide units are unchanged.",
    modify: (effect, type) =>
      type === "unit" && !effect.all && effect.add
        ? { ...effect, add: effect.add + 1 }
        : effect,
  },
  shoal: {
    name: "Debris Shoal",
    rule: "Front-wide effects establish and remove 1 less in each zone.",
    modify: (effect) =>
      effect.all
        ? {
            ...effect,
            ...(effect.add ? { add: effect.add - 1 } : {}),
            ...(effect.damage ? { damage: effect.damage - 1 } : {}),
          }
        : effect,
  },
} satisfies Record<string, Theater>;
export type TheaterId = keyof typeof THEATERS;
export const THEATER_IDS = Object.keys(THEATERS) as TheaterId[];

/** Tunable match rules. Stored on every game so a match describes itself. */
export interface Rules {
  targetScore: number;
  maxTurns: number;
  /** Energy equals the turn number up to this cap, and does not carry over. */
  energyCap: number;
  startHand: number;
  drawPerTurn: number;
  handCap: number;
  /** Cards one player may commit in a turn. */
  maxPlays: number;
  /** Consecutive held turns that secure a zone (0 disables securing). */
  secureAfter: number;
  /** Bonus points for securing; the zone then clears for both teams. */
  secureBonus: number;
  /** Extra points for holding the rotating focus zone (0 disables focus). */
  focusBonus: number;
  /** Ceiling on the combined fraction one team can strip from a zone in a turn. */
  fracCap: number;
  /**
   * Share of each stack that survives into the next turn, rounded up
   * (1 = presence is permanent, 0.5 = every stack halves after scoring).
   */
  retain: number;
}
export const DEFAULT_RULES: Rules = {
  targetScore: 16,
  maxTurns: 12,
  energyCap: 6,
  startHand: 4,
  drawPerTurn: 2,
  handCap: 6,
  maxPlays: 3,
  secureAfter: 3,
  secureBonus: 2,
  focusBonus: 0,
  fracCap: 0.75,
  retain: 1,
};
export const TURN_MS = 45_000;

/** Rules text generated from the data, so the two can never disagree. */
export function describe(effect: Effect): string {
  const where = effect.all ? " in every zone" : "";
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const parts: string[] = [];
  if (effect.damage)
    parts.push(`Remove ${effect.damage} enemy presence${where}.`);
  if (effect.damageFrac)
    parts.push(`Remove ${pct(effect.damageFrac)} of enemy presence${where}.`);
  if (effect.ambush)
    parts.push(
      `Ambush: remove ${effect.ambush} more where the enemy deployed a unit this turn.`,
    );
  if (effect.add) parts.push(`Establish ${effect.add} presence${where}.`);
  if (effect.amplify)
    parts.push(
      `Presence your team deploys there this turn arrives ${pct(effect.amplify)} stronger.`,
    );
  if (effect.shield)
    parts.push(`Shield: block ${effect.shield} removal there this turn.`);
  return parts.join(" ");
}
