// Treat released rulesets as immutable. New balance changes get a new version.
export const RULESET = 'frontier-1';
export const ZONES = ['The Ruins', 'The Citadel', 'The Wilds'] as const;
export const HEROES = {
  warden: { name: 'The Warden', role: 'Hold the line', ability: 'Entrench', description: 'Build lasting presence. Make every advance costly.', add: 4, damage: 0,
    deck: ['scout', 'scout', 'guard', 'guard', 'guard', 'rampart', 'rampart', 'rampart', 'bastion', 'bastion', 'raid', 'raid'] },
  shade: { name: 'The Shade', role: 'Turn the tide', ability: 'Ambush', description: 'Strike exposed positions. Seize ground in a single turn.', add: 1, damage: 3,
    deck: ['scout', 'scout', 'scout', 'guard', 'raid', 'raid', 'raid', 'breach', 'breach', 'breach', 'bastion', 'rampart'] }
} as const;
export type Hero = keyof typeof HEROES;
export interface Card { name: string; cost: number; add: number; damage: number; all?: boolean; text: string }
export const CARDS = {
  scout: { name: 'Pathfinder', cost: 1, add: 2, damage: 0, text: 'Establish 2 presence.' },
  guard: { name: 'Iron Guard', cost: 2, add: 4, damage: 0, text: 'Establish 4 presence.' },
  rampart: { name: 'Rampart', cost: 3, add: 6, damage: 0, text: 'Establish 6 presence.' },
  bastion: { name: 'Rally the Front', cost: 4, add: 2, damage: 0, all: true, text: 'Establish 2 presence in every zone.' },
  raid: { name: 'Night Raid', cost: 2, add: 1, damage: 3, text: 'Remove 3 enemy presence. Establish 1.' },
  breach: { name: 'Breach', cost: 4, add: 2, damage: 6, text: 'Remove 6 enemy presence. Establish 2.' }
} satisfies Record<string, Card>;
export type CardId = keyof typeof CARDS;
