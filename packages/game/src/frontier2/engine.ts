// frontier-2 rules: pure, deterministic, independent of I/O. Supports two or
// four seats on one shared front. A turn resolves every player's plan at once,
// in fixed phases, so neither seat order nor team order can matter:
//   1. deploy   — all presence lands
//   2. amplify  — each team's deployments this turn are scaled
//   3. strike   — removal (less shields) is measured against that total
//   4. control  — zone leads score, streaks advance, held zones are secured,
//                 then surviving presence thins out by the attrition rule
import {
  CARD_IDS,
  CARDS,
  DEFAULT_RULES,
  HERO_IDS,
  RULESET,
  THEATERS,
  card,
  hero,
  type CardId,
  type Effect,
  type Hero,
  type Rules,
  type Theater,
  type TheaterId,
} from "./content.js";

export type Team = 0 | 1;
export type Zone = 0 | 1 | 2;
export interface Play {
  card: CardId;
  zone: Zone;
}
export interface Action {
  /** Cards committed this turn, each to a zone. Empty is a pass. */
  plays: Play[];
  /** Zone for the signature ability, or null to hold it. */
  ability: Zone | null;
}
export interface Seat {
  id: string;
  team: Team;
  hero: Hero;
}
export interface Player extends Seat {
  hand: CardId[];
  draw: CardId[];
  discard: CardId[];
  abilityReadyTurn: number;
  missed: number;
}
/** Who has led a zone, and for how many consecutive turns. */
export interface Hold {
  team: Team | null;
  streak: number;
}
/** Ordered, public account of a resolution: what a client animates. */
export type TurnEvent =
  | { kind: "deploy"; zone: Zone; team: Team; amount: number }
  | { kind: "amplify"; zone: Zone; team: Team; amount: number }
  | {
      kind: "strike";
      zone: Zone;
      /** The team losing presence. */
      team: Team;
      amount: number;
      blocked: number;
      ambush: boolean;
    }
  | {
      kind: "control";
      zone: Zone;
      team: Team | null;
      points: number;
      streak: number;
    }
  | { kind: "secure"; zone: Zone; team: Team; points: number };
export interface Reveal {
  turn: number;
  focus: Zone | null;
  actions: {
    player: string;
    team: Team;
    hero: Hero;
    action: Action;
    timedOut: boolean;
  }[];
  points: [number, number];
  events: TurnEvent[];
}
export interface Game {
  ruleset: typeof RULESET;
  rules: Rules;
  theater: TheaterId;
  rng: number;
  focusOffset: number;
  turn: number;
  status: "playing" | "finished";
  players: Player[];
  board: [number, number][];
  holds: Hold[];
  scores: [number, number];
  pending: Record<string, Action>;
  winner: Team | "draw" | null;
  reason: "points" | "turn-limit" | "abandonment" | null;
  history: Reveal[];
}
export interface Outcome {
  board: [number, number][];
  holds: Hold[];
  points: [number, number];
  events: TurnEvent[];
}
export class RuleError extends Error {}

const ZONE_LIST: readonly Zone[] = [0, 1, 2];
const TEAMS: readonly Team[] = [0, 1];

function next(game: Pick<Game, "rng">): number {
  let x = game.rng;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  game.rng = x >>> 0;
  return game.rng;
}
function shuffle<T>(items: readonly T[], game: Pick<Game, "rng">): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor((next(game) / 4294967296) * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

// Theater-adjusted effects, computed once per theater.
interface Resolved {
  cards: Record<CardId, Effect>;
  abilities: Record<Hero, Effect>;
}
const resolvedCache = new Map<TheaterId, Resolved>();
function resolved(id: TheaterId): Resolved {
  let entry = resolvedCache.get(id);
  if (!entry) {
    const theater: Theater = THEATERS[id];
    entry = {
      cards: Object.fromEntries(
        CARD_IDS.map((c) => [c, theater.modify(card(c), card(c).type)]),
      ) as Record<CardId, Effect>,
      abilities: Object.fromEntries(
        HERO_IDS.map((h) => [h, theater.modify(hero(h).ability, "ability")]),
      ) as Record<Hero, Effect>,
    };
    resolvedCache.set(id, entry);
  }
  return entry;
}

export function energyFor(game: Pick<Game, "turn" | "rules">): number {
  return Math.min(game.turn, game.rules.energyCap);
}
/** The zone worth extra this turn, or null when the focus rule is off. */
export function focusZone(
  game: Pick<Game, "turn" | "rules" | "focusOffset">,
  turn = game.turn,
): Zone | null {
  return game.rules.focusBonus > 0
    ? (((turn + game.focusOffset) % 3) as Zone)
    : null;
}

export function createGame(
  seats: Seat[],
  seed: number,
  options: { theater?: TheaterId; rules?: Partial<Rules> } = {},
): Game {
  if (
    ![2, 4].includes(seats.length) ||
    new Set(seats.map((p) => p.id)).size !== seats.length ||
    seats.filter((p) => p.team === 0).length !== seats.length / 2 ||
    seats.filter((p) => p.team === 1).length !== seats.length / 2
  )
    throw new RuleError("Use two equally sized teams with unique players.");
  const game: Game = {
    ruleset: RULESET,
    rules: { ...DEFAULT_RULES, ...options.rules },
    theater: options.theater ?? "reach",
    rng: seed >>> 0 || 1,
    focusOffset: 0,
    turn: 1,
    status: "playing",
    players: [],
    board: [
      [0, 0],
      [0, 0],
      [0, 0],
    ],
    holds: [
      { team: null, streak: 0 },
      { team: null, streak: 0 },
      { team: null, streak: 0 },
    ],
    scores: [0, 0],
    pending: {},
    winner: null,
    reason: null,
    history: [],
  };
  game.focusOffset = next(game) % 3;
  const size = game.rules.startHand;
  game.players = seats.map((seat) => {
    const deck = shuffle<CardId>(hero(seat.hero).deck, game);
    // Guarantee a turn-one play: trade the priciest opening card for a 1-cost.
    if (!deck.slice(0, size).some((c) => card(c).cost <= 1)) {
      const cheap = deck.findIndex((c, i) => i >= size && card(c).cost <= 1);
      if (cheap !== -1) {
        let priciest = 0;
        for (let i = 1; i < size; i++)
          if (card(deck[i]!).cost > card(deck[priciest]!).cost) priciest = i;
        [deck[priciest], deck[cheap]] = [deck[cheap]!, deck[priciest]!];
      }
    }
    return {
      id: seat.id,
      team: seat.team,
      hero: seat.hero,
      hand: deck.splice(0, size),
      draw: deck,
      discard: [],
      abilityReadyTurn: 1,
      missed: 0,
    };
  });
  return game;
}

export function validateAction(
  game: Game,
  playerId: string,
  action: Action,
): void {
  const player = game.players.find((p) => p.id === playerId);
  if (game.status !== "playing" || !player)
    throw new RuleError("Match is not accepting actions.");
  if (game.pending[playerId])
    throw new RuleError("Your turn is already locked.");
  if (!action || !Array.isArray(action.plays))
    throw new RuleError("Malformed plan.");
  if (action.plays.length > game.rules.maxPlays)
    throw new RuleError(
      `Commit at most ${game.rules.maxPlays} cards in a turn.`,
    );
  const hand = [...player.hand];
  let cost = 0;
  for (const play of action.plays) {
    if (!ZONE_LIST.includes(play.zone)) throw new RuleError("Unknown zone.");
    if (!Object.hasOwn(CARDS, play.card)) throw new RuleError("Unknown card.");
    const index = hand.indexOf(play.card);
    if (index === -1) throw new RuleError("That card is not in your hand.");
    hand.splice(index, 1);
    cost += card(play.card).cost;
  }
  if (cost > energyFor(game))
    throw new RuleError("Not enough energy for that plan.");
  if (action.ability !== null) {
    if (!ZONE_LIST.includes(action.ability))
      throw new RuleError("Unknown zone.");
    if (game.turn < player.abilityReadyTurn)
      throw new RuleError("Ability is recharging.");
  }
}

export function lockAction(
  input: Game,
  playerId: string,
  action: Action,
): Game {
  validateAction(input, playerId, action);
  const game = structuredClone(input);
  game.pending[playerId] = {
    plays: action.plays.map((p) => ({ card: p.card, zone: p.zone })),
    ability: action.ability,
  };
  return game;
}

/**
 * Resolve a set of plans against the current board without touching the game.
 * resolveTurn commits the result; bots call this directly to weigh options.
 * A player with no entry in `actions` passes.
 */
export function simulate(
  game: Game,
  actions: Readonly<Record<string, Action | undefined>>,
  withEvents = false,
): Outcome {
  const effects = resolved(game.theater);
  // Indexed zone * 2 + team. Removal-side arrays are indexed by the TARGET team.
  const add = [0, 0, 0, 0, 0, 0];
  const amp = [0, 0, 0, 0, 0, 0];
  const shield = [0, 0, 0, 0, 0, 0];
  const damage = [0, 0, 0, 0, 0, 0];
  const frac = [0, 0, 0, 0, 0, 0];
  const ambush = [0, 0, 0, 0, 0, 0];
  const deployedUnit = [false, false, false, false, false, false];
  const apply = (effect: Effect, team: Team, zone: Zone, unit: boolean) => {
    const from = effect.all ? 0 : zone;
    const to = effect.all ? 2 : zone;
    for (let z = from; z <= to; z++) {
      const mine = z * 2 + team;
      const theirs = z * 2 + (1 - team);
      add[mine]! += effect.add ?? 0;
      amp[mine]! += effect.amplify ?? 0;
      shield[mine]! += effect.shield ?? 0;
      damage[theirs]! += effect.damage ?? 0;
      frac[theirs]! += effect.damageFrac ?? 0;
      ambush[theirs]! += effect.ambush ?? 0;
      if (unit) deployedUnit[mine] = true;
    }
  };
  for (const player of game.players) {
    const action = actions[player.id];
    if (!action) continue;
    for (const play of action.plays)
      apply(
        effects.cards[play.card],
        player.team,
        play.zone,
        card(play.card).type === "unit",
      );
    if (action.ability !== null)
      apply(effects.abilities[player.hero], player.team, action.ability, false);
  }

  const events: TurnEvent[] = [];
  const board: [number, number][] = [];
  const holds: Hold[] = [];
  const points: [number, number] = [0, 0];
  const focus = focusZone(game);
  const { rules } = game;
  for (const zone of ZONE_LIST) {
    const before = game.board[zone]!;
    const massed: [number, number] = [0, 0];
    for (const team of TEAMS) {
      const i = zone * 2 + team;
      massed[team] = before[team] + add[i]!;
      if (withEvents && add[i]! > 0)
        events.push({ kind: "deploy", zone, team, amount: add[i]! });
    }
    for (const team of TEAMS) {
      // Only this turn's deployments scale, so a boost can never compound.
      const i = zone * 2 + team;
      const boost = Math.floor(add[i]! * amp[i]!);
      massed[team] += boost;
      if (withEvents && boost > 0)
        events.push({ kind: "amplify", zone, team, amount: boost });
    }
    const after: [number, number] = [0, 0];
    for (const team of TEAMS) {
      const i = zone * 2 + team;
      const sprung = deployedUnit[i]! && ambush[i]! > 0;
      const incoming =
        damage[i]! +
        (sprung ? ambush[i]! : 0) +
        Math.floor(massed[team] * Math.min(frac[i]!, rules.fracCap));
      const blocked = Math.min(shield[i]!, incoming);
      const removed = Math.min(massed[team], incoming - blocked);
      after[team] = massed[team] - removed;
      if (withEvents && incoming > 0)
        events.push({
          kind: "strike",
          zone,
          team,
          amount: removed,
          blocked,
          ambush: sprung,
        });
    }
    const leader: Team | null =
      after[0] === after[1] ? null : after[0] > after[1] ? 0 : 1;
    const previous = game.holds[zone]!;
    let hold: Hold =
      leader === null
        ? { team: null, streak: 0 }
        : {
            team: leader,
            streak: previous.team === leader ? previous.streak + 1 : 1,
          };
    if (leader !== null) {
      const earned = 1 + (focus === zone ? rules.focusBonus : 0);
      points[leader] += earned;
      if (withEvents)
        events.push({
          kind: "control",
          zone,
          team: leader,
          points: earned,
          streak: hold.streak,
        });
      if (rules.secureAfter > 0 && hold.streak >= rules.secureAfter) {
        // Secured: bank the bonus and reopen the zone. Surplus is not carried.
        points[leader] += rules.secureBonus;
        after[0] = 0;
        after[1] = 0;
        hold = { team: null, streak: 0 };
        if (withEvents)
          events.push({
            kind: "secure",
            zone,
            team: leader,
            points: rules.secureBonus,
          });
      }
    } else if (withEvents) {
      events.push({ kind: "control", zone, team: null, points: 0, streak: 0 });
    }
    if (rules.retain < 1) {
      // Attrition: what is left after scoring thins out before the next turn.
      after[0] = Math.ceil(after[0] * rules.retain);
      after[1] = Math.ceil(after[1] * rules.retain);
    }
    board.push(after);
    holds.push(hold);
  }
  return { board, holds, points, events };
}

export function resolveTurn(input: Game, allowTimeout = false): Game {
  if (input.status !== "playing") throw new RuleError("Match has ended.");
  if (!allowTimeout && input.players.some((p) => !input.pending[p.id]))
    throw new RuleError("Waiting for players.");
  const game = structuredClone(input);
  const actions: Record<string, Action> = {};
  const reveal: Reveal = {
    turn: game.turn,
    focus: focusZone(game),
    actions: [],
    points: [0, 0],
    events: [],
  };
  for (const player of game.players) {
    const pending = game.pending[player.id];
    const action: Action = pending ?? { plays: [], ability: null };
    player.missed = pending ? 0 : player.missed + 1;
    actions[player.id] = action;
    reveal.actions.push({
      player: player.id,
      team: player.team,
      hero: player.hero,
      action,
      timedOut: !pending,
    });
    for (const play of action.plays) {
      player.hand.splice(player.hand.indexOf(play.card), 1);
      player.discard.push(play.card);
    }
    if (action.ability !== null)
      player.abilityReadyTurn =
        game.turn + hero(player.hero).ability.cooldown;
  }
  const outcome = simulate(game, actions, true);
  game.board = outcome.board;
  game.holds = outcome.holds;
  game.scores[0] += outcome.points[0];
  game.scores[1] += outcome.points[1];
  reveal.points = outcome.points;
  reveal.events = outcome.events;
  game.history.push(reveal);
  game.pending = {};

  const abandoned = TEAMS.filter((team) =>
    game.players.filter((p) => p.team === team).every((p) => p.missed >= 3),
  );
  const top = Math.max(game.scores[0], game.scores[1]);
  if (abandoned.length) {
    game.status = "finished";
    game.reason = "abandonment";
    game.winner = abandoned.length === 2 ? "draw" : abandoned[0] === 0 ? 1 : 0;
  } else if (top >= game.rules.targetScore || game.turn >= game.rules.maxTurns) {
    game.status = "finished";
    game.reason = top >= game.rules.targetScore ? "points" : "turn-limit";
    game.winner =
      game.scores[0] === game.scores[1]
        ? "draw"
        : game.scores[0] > game.scores[1]
          ? 0
          : 1;
  } else {
    game.turn++;
    for (const player of game.players) {
      for (let n = 0; n < game.rules.drawPerTurn; n++) {
        if (player.hand.length >= game.rules.handCap) break;
        if (!player.draw.length) {
          player.draw = shuffle(player.discard, game);
          player.discard = [];
        }
        const drawn = player.draw.shift();
        if (!drawn) break;
        player.hand.push(drawn);
      }
    }
  }
  return game;
}

export function playerView(game: Game, playerId: string) {
  if (!game.players.some((p) => p.id === playerId))
    throw new RuleError("You are not in this match.");
  // Allowlist projection: never serialize internal state and then redact it.
  return {
    ruleset: game.ruleset,
    rules: { ...game.rules },
    theater: game.theater,
    turn: game.turn,
    energy: energyFor(game),
    focus: focusZone(game),
    nextFocus: focusZone(game, game.turn + 1),
    status: game.status,
    board: structuredClone(game.board),
    holds: structuredClone(game.holds),
    scores: [...game.scores],
    winner: game.winner,
    reason: game.reason,
    history: structuredClone(game.history),
    players: game.players.map((p) => ({
      id: p.id,
      team: p.team,
      hero: p.hero,
      handCount: p.hand.length,
      abilityReadyTurn: p.abilityReadyTurn,
      locked: !!game.pending[p.id],
      ...(p.id === playerId ? { hand: [...p.hand] } : {}),
    })),
  };
}
export type GameView = ReturnType<typeof playerView>;
