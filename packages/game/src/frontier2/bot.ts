// Reference opponents for frontier-2. They serve two jobs: the balance bench,
// and (later) filling seats so a first match never needs a second human.
// Both use only what their seat may know: the board, public decks and discards,
// and their own hand.
//   greedy — best plan assuming everyone else passes.
//   reader — best plan against plausible plans from everyone else.
import { card, type CardId } from "./content.js";
import {
  energyFor,
  simulate,
  type Action,
  type Game,
  type Outcome,
  type Play,
  type Player,
  type Team,
  type Zone,
} from "./engine.js";

export type Rand = () => number;
export type Bot = (game: Game, playerId: string, rand: Rand) => Action;

export function seededRand(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BEAM = 4;
const MARGIN_CAP = 8;
const ZONES: readonly Zone[] = [0, 1, 2];

/** How good a resolved board is for a team. Points dominate; position breaks ties. */
function evaluate(team: Team, outcome: Outcome): number {
  const foe = team === 0 ? 1 : 0;
  let value = (outcome.points[team] - outcome.points[foe]) * 100;
  for (const zone of ZONES) {
    const [a, b] = outcome.board[zone]!;
    const margin = team === 0 ? a - b : b - a;
    // A lead past the cap is surplus: it scores nothing and is lost on securing.
    value += Math.max(-MARGIN_CAP, Math.min(MARGIN_CAP, margin)) * 3;
    const hold = outcome.holds[zone]!;
    if (hold.team !== null)
      value += (hold.team === team ? 1 : -1) * hold.streak * 15;
  }
  return value;
}

interface Option {
  action: Action;
  value: number;
}

/**
 * The best few plans for a player, given fixed plans for everyone else.
 * Cards are added one at a time (beam search), then the ability is aimed.
 */
function options(
  game: Game,
  me: Player,
  others: Readonly<Record<string, Action | undefined>>,
  keep: number,
): Option[] {
  const energy = energyFor(game);
  const work: Record<string, Action | undefined> = { ...others };
  const score = (plays: Play[], ability: Zone | null, cost: number): number => {
    work[me.id] = { plays, ability };
    // Energy spent is a small cost, so a play has to earn its place.
    return evaluate(me.team, simulate(game, work)) - cost;
  };
  interface Node {
    plays: Play[];
    used: number[];
    cost: number;
    value: number;
  }
  let frontier: Node[] = [
    { plays: [], used: [], cost: 0, value: score([], null, 0) },
  ];
  const found: Node[] = [...frontier];
  for (let depth = 0; depth < game.rules.maxPlays; depth++) {
    const grown: Node[] = [];
    for (const node of frontier) {
      const tried = new Set<CardId>();
      me.hand.forEach((id, index) => {
        if (node.used.includes(index) || tried.has(id)) return;
        tried.add(id);
        const def = card(id);
        const cost = node.cost + def.cost;
        if (cost > energy) return;
        for (const zone of def.all ? ZONES.slice(0, 1) : ZONES) {
          const plays = [...node.plays, { card: id, zone }];
          grown.push({
            plays,
            used: [...node.used, index],
            cost,
            value: score(plays, null, cost),
          });
        }
      });
    }
    if (!grown.length) break;
    grown.sort((x, y) => y.value - x.value);
    frontier = grown.slice(0, BEAM);
    found.push(...frontier);
  }
  found.sort((x, y) => y.value - x.value);
  const ready = game.turn >= me.abilityReadyTurn;
  const result = found.slice(0, keep).map((node): Option => {
    let best: Option = {
      action: { plays: node.plays, ability: null },
      value: node.value,
    };
    if (ready)
      for (const zone of ZONES) {
        // Hold the ability unless it clearly changes something this turn.
        const value = score(node.plays, zone, node.cost) - 10;
        if (value > best.value)
          best = { action: { plays: node.plays, ability: zone }, value };
      }
    return best;
  });
  result.sort((x, y) => y.value - x.value);
  return result;
}

function seat(game: Game, playerId: string): Player {
  const me = game.players.find((p) => p.id === playerId);
  if (!me) throw new Error("Bot was asked to play an empty seat.");
  return me;
}

export const greedy: Bot = (game, playerId) =>
  options(game, seat(game, playerId), {}, 1)[0]!.action;

const SCENARIOS = 3;
const SHORTLIST = 6;

/** A hand the player could plausibly hold: drawn from the cards not yet played. */
function plausibleHand(player: Player, rand: Rand): CardId[] {
  const unseen = [...player.hand, ...player.draw];
  for (let i = unseen.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [unseen[i], unseen[j]] = [unseen[j]!, unseen[i]!];
  }
  return unseen.slice(0, player.hand.length);
}

export const reader: Bot = (game, playerId, rand) => {
  const me = seat(game, playerId);
  const shortlist = options(game, me, {}, SHORTLIST);
  if (shortlist.length < 2) return shortlist[0]!.action;
  const totals = shortlist.map(() => 0);
  for (let n = 0; n < SCENARIOS; n++) {
    const others: Record<string, Action | undefined> = {};
    for (const other of game.players) {
      if (other.id === playerId) continue;
      const imagined: Player = { ...other, hand: plausibleHand(other, rand) };
      others[other.id] = options(game, imagined, {}, 1)[0]!.action;
    }
    shortlist.forEach((option, index) => {
      const cost = option.action.plays.reduce(
        (sum, play) => sum + card(play.card).cost,
        0,
      );
      totals[index]! +=
        evaluate(
          me.team,
          simulate(game, { ...others, [playerId]: option.action }),
        ) - cost;
    });
  }
  let best = 0;
  for (let i = 1; i < totals.length; i++)
    if (totals[i]! > totals[best]!) best = i;
  return shortlist[best]!.action;
};
