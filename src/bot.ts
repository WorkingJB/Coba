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
import { heroDef } from "./heroes.js";
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
    const targets = card.allZones ? ZONE_IDS : [action.zone];
    for (const z of targets) {
      if (card.kind === "unit") {
        pres[z].me += card.presence ?? 0;
      } else if (card.kind === "buff") {
        const after = pres[z].me + (card.presence ?? 0);
        pres[z].me = after + Math.floor(after * (card.amplify ?? 0));
      } else {
        const rem = (card.damage ?? 0) + Math.floor(pres[z].foe * (card.damageFrac ?? 0));
        pres[z].foe = Math.max(0, pres[z].foe - rem);
        pres[z].me += card.selfPresence ?? 0;
      }
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

/** If the ability is ready, pick the zone where firing it helps most. */
function bestAbilityZone(state: GameState, player: PlayerId): ZoneId | null {
  const p = state.players[player];
  if (p.abilityReady > 0) return null;
  const ability = heroDef(p.heroId).ability;
  const foe = opponentOf(player);

  let bestZone: ZoneId | null = null;
  let bestScore = -Infinity;
  for (const target of ZONE_IDS) {
    let controlled = 0;
    let margin = 0;
    for (const z of ZONE_IDS) {
      let me = state.zones[z].presence[player];
      let fo = state.zones[z].presence[foe];
      if (z === target) {
        if (ability.kind === "addSelf") {
          me += ability.amount;
        } else if (ability.kind === "amplify") {
          const after = me + ability.amount;
          me = after + Math.floor(after * (ability.amplify ?? 0));
        } else {
          fo = Math.max(0, fo - ability.amount);
          me += ability.selfPlant ?? 0;
        }
      }
      if (me > fo) controlled += 1;
      margin += me - fo;
    }
    const sc = controlled * 1000 + margin;
    if (sc > bestScore) {
      bestScore = sc;
      bestZone = target;
    }
  }
  return bestZone;
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
  // Fire the ability whenever it's ready (free value), on its best zone.
  return { ...best, ability: bestAbilityZone(state, player) };
}
