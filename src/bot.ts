// A simple greedy policy so we can self-play the engine and feel the loop.
// Not meant to be smart — just good enough to surface whether the archetypes
// and territory rules produce interesting decisions. Real AI/opponents come later.

import {
  type GameState,
  type PlannedAction,
  type PlayerId,
  type ZoneId,
  ZONE_IDS,
  opponentOf,
} from "./types.js";
import { cardDef } from "./cards.js";
import { legalActions } from "./engine.js";
import { territoryDef } from "./territory.js";

/** Evaluate the board immediately after applying a single action (no opponent move). */
function scoreAction(state: GameState, action: PlannedAction): number {
  const me = action.player;
  const foe = opponentOf(me);

  // Snapshot current presence.
  const pres: Record<ZoneId, { me: number; foe: number }> = {} as never;
  for (const z of ZONE_IDS) {
    pres[z] = { me: state.zones[z].presence[me], foe: state.zones[z].presence[foe] };
  }

  let cost = 0;
  if (action.cardId !== null && action.zone !== null) {
    const card = territoryDef(state.territoryId).modifyCard(cardDef(action.cardId));
    cost = card.cost;
    if (card.kind === "unit") {
      pres[action.zone].me += card.presence ?? 0;
    } else {
      pres[action.zone].foe = Math.max(0, pres[action.zone].foe - (card.damage ?? 0));
      pres[action.zone].me += card.selfPresence ?? 0;
    }
  }

  let controlled = 0;
  let margin = 0;
  for (const z of ZONE_IDS) {
    if (pres[z].me > pres[z].foe) controlled += 1;
    margin += pres[z].me - pres[z].foe;
  }
  // Hold as many zones as possible; break ties toward bigger margins, then efficiency.
  return controlled * 1000 + margin - cost * 0.5;
}

export function chooseAction(state: GameState, player: PlayerId): PlannedAction {
  const options = legalActions(state, player);
  let best = options[0]!;
  let bestScore = -Infinity;
  for (const opt of options) {
    const s = scoreAction(state, opt);
    if (s > bestScore) {
      bestScore = s;
      best = opt;
    }
  }
  return best;
}
