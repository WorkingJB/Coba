// Territory modifiers change the RULES of a battlefield, never raw power level.
// Each captured territory in the faction war maps to one of these.
//
// ⚠️ allZones interaction: `modifyCard` is applied ONCE, then the engine applies
// the resulting card to every zone for an `allZones` card. So a *flat per-card*
// bonus (Volcanic's +2 damage, Ancient Forest's +1 presence) would land on all
// three zones — tripling on board-wide cards. That bug made the Conjurer ~95% on
// Forest and the Magus/Blight ~84–100% on Volcanic. Fix: flat bonuses apply only
// to single-zone cards (`!card.allZones`); board-wide cards are "too diffuse" to
// get the focused-ground bonus. Narrow Pass is the inverse — it specifically
// blunts board-wide cards.

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
    describe: "Focused spells bite harder: single-zone spells remove +2. Board-wide spells are too diffuse to benefit.",
    // Single-zone only — a flat +2 on an allZones spell would land 3× (the
    // Magus/Blight Volcanic-dominance bug). Board-wide spells resolve at face.
    modifyCard: (card) =>
      card.kind === "spell" && !card.allZones
        ? { ...card, damage: (card.damage ?? 0) + 2 }
        : card,
  },
  ancient_forest: {
    id: "ancient_forest",
    name: "Ancient Forest",
    describe: "Focused units dig in: single-zone units +1 presence. Board-wide swarms spread too thin to gain it.",
    // Single-zone only — a flat +1 on an allZones unit would land 3× (the
    // Conjurer ~95%-on-Forest bug). Board-wide units resolve at face.
    modifyCard: (card) =>
      card.kind === "unit" && !card.allZones
        ? { ...card, presence: (card.presence ?? 0) + 1 }
        : card,
  },
  narrow_pass: {
    id: "narrow_pass",
    name: "Narrow Pass",
    describe: "Tight ground punishes spreading thin: board-wide (allZones) cards contribute 1 less per zone. Focused cards are unaffected.",
    // The counter-board to WIDE decks (Conjurer, Blight) — blunts board-wide
    // swings without touching focused cards. Reduces the per-zone presence and
    // damage of allZones cards by 1 (floor 0); leaves seize/amplify intact.
    modifyCard: (card) =>
      card.allZones
        ? {
            ...card,
            ...(card.presence !== undefined ? { presence: Math.max(0, card.presence - 1) } : {}),
            ...(card.damage !== undefined ? { damage: Math.max(0, card.damage - 1) } : {}),
          }
        : card,
  },
};

export function territoryDef(id: string): TerritoryDef {
  const t = TERRITORIES[id];
  if (!t) throw new Error(`Unknown territory id: ${id}`);
  return t;
}
