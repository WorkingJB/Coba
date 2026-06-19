// Territory modifiers change the RULES of a battlefield, never raw power level.
// Each captured territory in the faction war maps to one of these. The prototype
// ships one real modifier (Volcanic Forge) plus a neutral control field.

import type { CardDef } from "./types.js";

export interface TerritoryDef {
  id: string;
  name: string;
  describe: string;
  /** Return an adjusted copy of the card as it resolves on this battlefield. */
  modifyCard(card: CardDef): CardDef;
}

export const TERRITORIES: Record<string, TerritoryDef> = {
  neutral_field: {
    id: "neutral_field",
    name: "Neutral Field",
    describe: "No modifiers. Cards resolve at face value.",
    modifyCard: (card) => card,
  },
  volcanic_forge: {
    id: "volcanic_forge",
    name: "Volcanic Forge",
    describe: "Spells (damage) resolve stronger: +2 presence removed.",
    modifyCard: (card) =>
      card.kind === "spell"
        ? { ...card, damage: (card.damage ?? 0) + 2 }
        : card,
  },
  ancient_forest: {
    id: "ancient_forest",
    name: "Ancient Forest",
    describe: "Units dig in: +1 presence contributed.",
    modifyCard: (card) =>
      card.kind === "unit"
        ? { ...card, presence: (card.presence ?? 0) + 1 }
        : card,
  },
};

export function territoryDef(id: string): TerritoryDef {
  const t = TERRITORIES[id];
  if (!t) throw new Error(`Unknown territory id: ${id}`);
  return t;
}
