import { CARDS, HEROES, RULESET, type Card, type CardId, type Hero } from './content.js';
export type Team = 0 | 1;
export type Zone = 0 | 1 | 2;
export interface Action { card: CardId | null; zone: Zone; ability: boolean }
export interface Player { id: string; team: Team; hero: Hero; hand: CardId[]; draw: CardId[]; discard: CardId[]; abilityReadyTurn: number; missed: number }
export interface Reveal { turn: number; actions: { player: string; hero: Hero; action: Action; timedOut: boolean }[]; points: [number, number] }
export interface Game {
  ruleset: typeof RULESET; rng: number; turn: number; status: 'playing' | 'finished';
  players: Player[]; board: [number, number][]; scores: [number, number];
  pending: Record<string, Action>; winner: Team | 'draw' | null;
  reason: 'points' | 'turn-limit' | 'abandonment' | null; history: Reveal[];
}
export class RuleError extends Error {}
export const TURN_MS = 30_000;
export const MAX_TURNS = 16;
export const TARGET_SCORE = 15;
function shuffle<T>(items: readonly T[], game: Pick<Game, 'rng'>): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    let x = game.rng; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; game.rng = x >>> 0;
    const j = Math.floor((game.rng / 4294967296) * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}
export function createGame(seats: { id: string; team: Team; hero: Hero }[], seed: number): Game {
  if (![2, 4].includes(seats.length) || new Set(seats.map(p => p.id)).size !== seats.length ||
      seats.filter(p => p.team === 0).length !== seats.length / 2 || seats.filter(p => p.team === 1).length !== seats.length / 2)
    throw new RuleError('Use two equally sized teams with unique players.');
  const game: Game = { ruleset: RULESET, rng: (seed >>> 0) || 1, turn: 1, status: 'playing', players: [],
    board: [[0, 0], [0, 0], [0, 0]], scores: [0, 0], pending: {}, winner: null, reason: null, history: [] };
  game.players = seats.map(seat => {
    const deck = shuffle<CardId>(HEROES[seat.hero].deck, game);
    // Guarantee one opening play without revealing the future draw order.
    const scout = deck.indexOf('scout'); deck.splice(scout, 1);
    return { ...seat, hand: ['scout', ...deck.splice(0, 3)], draw: deck, discard: [], abilityReadyTurn: 1, missed: 0 };
  });
  return game;
}
export function validateAction(game: Game, playerId: string, action: Action): void {
  const player = game.players.find(p => p.id === playerId);
  if (game.status !== 'playing' || !player) throw new RuleError('Match is not accepting actions.');
  if (game.pending[playerId]) throw new RuleError('Your turn is already locked.');
  if (![0, 1, 2].includes(action.zone)) throw new RuleError('Unknown zone.');
  if (action.card !== null && (!player.hand.includes(action.card) || CARDS[action.card].cost > Math.min(game.turn, 6)))
    throw new RuleError('That card is not playable.');
  if (action.ability && game.turn < player.abilityReadyTurn) throw new RuleError('Ability is recharging.');
}
export function lockAction(input: Game, playerId: string, action: Action): Game {
  validateAction(input, playerId, action);
  const game = structuredClone(input); game.pending[playerId] = { ...action }; return game;
}
export function resolveTurn(input: Game, allowTimeout = false): Game {
  if (input.status !== 'playing') throw new RuleError('Match has ended.');
  if (!allowTimeout && input.players.some(p => !input.pending[p.id])) throw new RuleError('Waiting for players.');
  const game = structuredClone(input);
  const additions = [[0, 0], [0, 0], [0, 0]];
  const damage = [[0, 0], [0, 0], [0, 0]];
  const reveal: Reveal = { turn: game.turn, actions: [], points: [0, 0] };
  for (const player of game.players) {
    const timedOut = !game.pending[player.id];
    const action = game.pending[player.id] ?? { card: null, zone: 0, ability: false };
    player.missed = timedOut ? player.missed + 1 : 0;
    reveal.actions.push({ player: player.id, hero: player.hero, action, timedOut });
    if (action.card) {
      const card: Card = CARDS[action.card];
      player.hand.splice(player.hand.indexOf(action.card), 1); player.discard.push(action.card);
      for (const zone of card.all ? [0, 1, 2] : [action.zone]) {
        additions[zone]![player.team]! += card.add;
        damage[zone]![1 - player.team]! += card.damage;
      }
    }
    if (action.ability) {
      const hero = HEROES[player.hero];
      additions[action.zone]![player.team]! += hero.add;
      damage[action.zone]![1 - player.team]! += hero.damage;
      player.abilityReadyTurn = game.turn + 4;
    }
  }
  // Aggregate both sides before applying: no seat-order advantage, including 2v2.
  for (let zone = 0; zone < 3; zone++) {
    for (const team of [0, 1] as const) game.board[zone]![team] = Math.max(0, game.board[zone]![team] + additions[zone]![team]! - damage[zone]![team]!);
    const [a, b] = game.board[zone]!;
    if (a !== b) { const team = a > b ? 0 : 1; game.scores[team]++; reveal.points[team]++; }
  }
  game.history.push(reveal); game.pending = {};
  const abandoned = ([0, 1] as const).filter(team => game.players.filter(p => p.team === team).every(p => p.missed >= 3));
  if (abandoned.length) {
    game.status = 'finished'; game.reason = 'abandonment'; game.winner = abandoned.length === 2 ? 'draw' : abandoned[0] === 0 ? 1 : 0;
  } else if (Math.max(...game.scores) >= TARGET_SCORE || game.turn >= MAX_TURNS) {
    game.status = 'finished'; game.reason = Math.max(...game.scores) >= TARGET_SCORE ? 'points' : 'turn-limit';
    game.winner = game.scores[0] === game.scores[1] ? 'draw' : game.scores[0] > game.scores[1] ? 0 : 1;
  } else {
    game.turn++;
    for (const player of game.players) {
      if (player.hand.length >= 5) continue;
      if (!player.draw.length) { player.draw = shuffle(player.discard, game); player.discard = []; }
      const card = player.draw.shift(); if (card) player.hand.push(card);
    }
  }
  return game;
}
export function playerView(game: Game, playerId: string) {
  if (!game.players.some(p => p.id === playerId)) throw new RuleError('You are not in this match.');
  // Allowlist projection: never serialize internal state and then try to redact it.
  return { ruleset: game.ruleset, turn: game.turn, status: game.status, board: structuredClone(game.board), scores: [...game.scores],
    winner: game.winner, reason: game.reason, history: structuredClone(game.history),
    players: game.players.map(p => ({ id: p.id, team: p.team, hero: p.hero, handCount: p.hand.length,
      abilityReadyTurn: p.abilityReadyTurn, locked: !!game.pending[p.id], ...(p.id === playerId ? { hand: [...p.hand] } : {}) })) };
}
export type GameView = ReturnType<typeof playerView>;
