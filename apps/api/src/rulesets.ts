// Ruleset dispatch. A match is created under one ruleset and keeps it for
// life, so a balance change ships as a new entry here while matches already
// in flight finish on the rules they started with.
import { z } from "zod";
import * as f1 from "../../../packages/game/src/engine.js";
import { CARDS as CARDS_1, HEROES as HEROES_1 } from "../../../packages/game/src/content.js";
import * as f2 from "../../../packages/game/src/frontier2/engine.js";
import {
  CARD_IDS as CARDS_2,
  DEFAULT_RULES,
  HERO_IDS as HEROES_2,
  TURN_MS as TURN_MS_2,
} from "../../../packages/game/src/frontier2/content.js";
import { lockBots } from "../../../packages/game/src/frontier2/bot.js";

export const RULESET_IDS = ["frontier-1", "frontier-2"] as const;
export type RulesetId = (typeof RULESET_IDS)[number];
export type AnyGame = f1.Game | f2.Game;
export interface SeatRow {
  id: string;
  hero: string;
  team: 0 | 1;
  bot?: true;
}

export interface Ruleset {
  turnMs: number;
  /** Seat counts a lobby may be created with. */
  sizes: readonly number[];
  heroes: readonly string[];
  /** Whether empty seats can be filled by reference bots. */
  bots: boolean;
  /** Shape of an action on the wire. Ownership and cost are the engine's job. */
  action: z.ZodType;
  create(seats: SeatRow[], seed: number): AnyGame;
  lock(game: AnyGame, actor: string, action: unknown): AnyGame;
  resolve(game: AnyGame, allowTimeout: boolean): AnyGame;
  /** Plans for seats nobody is sitting in. Must be a pure function of the game. */
  auto(game: AnyGame): AnyGame;
  view(game: AnyGame, actor: string): unknown;
}

const zone = z.union([z.literal(0), z.literal(1), z.literal(2)]);
const keys = <T extends string>(ids: readonly T[]) => ids as [T, ...T[]];

const frontier1: Ruleset = {
  turnMs: f1.TURN_MS,
  sizes: [2],
  heroes: Object.keys(HEROES_1),
  bots: false,
  action: z
    .object({
      card: z.enum(keys(Object.keys(CARDS_1))).nullable(),
      zone,
      ability: z.boolean(),
    })
    .strict(),
  create: (seats, seed) =>
    f1.createGame(seats as Parameters<typeof f1.createGame>[0], seed),
  lock: (game, actor, action) =>
    f1.lockAction(game as f1.Game, actor, action as f1.Action),
  resolve: (game, allowTimeout) => f1.resolveTurn(game as f1.Game, allowTimeout),
  auto: (game) => game,
  view: (game, actor) => f1.playerView(game as f1.Game, actor),
};

const frontier2: Ruleset = {
  turnMs: TURN_MS_2,
  sizes: [2, 4],
  heroes: HEROES_2,
  bots: true,
  action: z
    .object({
      plays: z
        .array(z.object({ card: z.enum(keys(CARDS_2)), zone }).strict())
        .max(DEFAULT_RULES.maxPlays),
      ability: zone.nullable(),
    })
    .strict(),
  create: (seats, seed) => f2.createGame(seats as f2.Seat[], seed),
  lock: (game, actor, action) =>
    f2.lockAction(game as f2.Game, actor, action as f2.Action),
  resolve: (game, allowTimeout) => f2.resolveTurn(game as f2.Game, allowTimeout),
  auto: (game) => lockBots(game as f2.Game),
  view: (game, actor) => f2.playerView(game as f2.Game, actor),
};

export const RULESETS: Record<RulesetId, Ruleset> = {
  "frontier-1": frontier1,
  "frontier-2": frontier2,
};
export const isRuleError = (error: unknown): error is Error =>
  error instanceof f1.RuleError || error instanceof f2.RuleError;

interface ViewBase {
  id: string;
  code: string;
  revision: number;
  status: "lobby" | "playing" | "finished";
  /** Seats the match starts with. */
  size: number;
  /** The player who created the lobby and may start it early. */
  host: string;
  deadline: string | null;
  you: string;
}
/** What a seated player receives. Narrow on `ruleset` to read `game`. */
export type MatchView = ViewBase &
  (
    | {
        ruleset: "frontier-1";
        seats: { id: string; hero: keyof typeof HEROES_1; team: 0 | 1 }[];
        game: f1.GameView | null;
      }
    | {
        ruleset: "frontier-2";
        seats: f2.Seat[];
        game: f2.GameView | null;
      }
  );
