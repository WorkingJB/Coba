// Balance bench for frontier-2. Runs on CI (`npm run bench`), never locally.
// Bots stand in for players, so read the numbers as direction, not truth:
// they show card arithmetic and structural problems, not how the game feels.
import {
  HERO_IDS,
  THEATER_IDS,
  THEATERS,
  hero,
  type Hero,
  type Rules,
  type TheaterId,
} from "./content.js";
import {
  createGame,
  lockAction,
  resolveTurn,
  type Seat,
  type Team,
} from "./engine.js";
import { reader, seededRand, type Bot } from "./bot.js";

// Balance is judged on average score margin, not bot win rate. Bots play so
// consistently that a one-point edge in a 16-point game reads as a 95% win
// rate; people are far noisier. Win rate is still printed for reference.
// Hard limits can fail the build. Targets are what tuning is aiming for.
const GATE = { margin: 5, seat: [45, 55] } as const;
const TARGET = { margin: 2.5 } as const;
const SCALE = Number(process.env.BENCH_SCALE ?? 1);
const games = (n: number) => Math.max(2, Math.round((n * SCALE) / 2) * 2);

interface Result {
  winner: Team | "draw";
  turns: number;
  /** Team 0's final score minus team 1's. */
  diff: number;
  margin: number;
  /** The winner trailed on points after turn 4. */
  comeback: boolean;
  leadChanges: number;
  onPoints: boolean;
}
interface Setup {
  teams: [Hero[], Hero[]];
  seed: number;
  bot: Bot;
  theater?: TheaterId;
  rules?: Partial<Rules>;
}
function play(setup: Setup): Result {
  const seats: Seat[] = [];
  setup.teams[0].forEach((h, i) => {
    seats.push({ id: `a${i}`, team: 0, hero: h });
    seats.push({ id: `b${i}`, team: 1, hero: setup.teams[1][i]! });
  });
  let game = createGame(seats, setup.seed, {
    theater: setup.theater,
    rules: setup.rules,
  });
  const rand = seededRand(setup.seed * 7919 + 13);
  let leader = 0;
  let leadChanges = 0;
  let atTurnFour = 0;
  while (game.status === "playing") {
    const plans = game.players.map(
      (p) => [p.id, setup.bot(game, p.id, rand)] as const,
    );
    for (const [id, plan] of plans) game = lockAction(game, id, plan);
    game = resolveTurn(game);
    const diff = Math.sign(game.scores[0] - game.scores[1]);
    if (diff !== 0 && leader !== 0 && diff !== leader) leadChanges++;
    if (diff !== 0) leader = diff;
    if (game.history.length === 4) atTurnFour = diff;
  }
  const winner = game.winner ?? "draw";
  return {
    winner,
    turns: game.history.length,
    diff: game.scores[0] - game.scores[1],
    margin: Math.abs(game.scores[0] - game.scores[1]),
    comeback:
      winner !== "draw" && atTurnFour !== 0 && (atTurnFour > 0 ? 0 : 1) !== winner,
    leadChanges,
    onPoints: game.reason === "points",
  };
}

interface Tally {
  games: number;
  wins: number; // for the first-listed side
  draws: number;
  seatZero: number; // decisive games won from team 0
  decisive: number;
  turns: number;
  comebacks: number;
  leadChanges: number;
  blowouts: number;
  onPoints: number;
  lead: number; // summed score margin for the first-listed side
}
const emptyTally = (): Tally => ({
  games: 0,
  wins: 0,
  draws: 0,
  seatZero: 0,
  decisive: 0,
  turns: 0,
  comebacks: 0,
  leadChanges: 0,
  blowouts: 0,
  onPoints: 0,
  lead: 0,
});
function merge(into: Tally, from: Tally): void {
  for (const key of Object.keys(into) as (keyof Tally)[]) into[key] += from[key];
}
/** Side A against side B, alternating which of them sits on team 0. */
function series(
  a: Hero[],
  b: Hero[],
  count: number,
  seedBase: number,
  options: Omit<Setup, "teams" | "seed">,
): Tally {
  const tally = emptyTally();
  for (let i = 0; i < count; i++) {
    const aFirst = i % 2 === 0;
    const result = play({
      ...options,
      teams: aFirst ? [a, b] : [b, a],
      seed: seedBase + i,
    });
    tally.games++;
    tally.turns += result.turns;
    tally.leadChanges += result.leadChanges;
    tally.lead += aFirst ? result.diff : -result.diff;
    if (result.margin >= 8) tally.blowouts++;
    if (result.comeback) tally.comebacks++;
    if (result.onPoints) tally.onPoints++;
    if (result.winner === "draw") {
      tally.draws++;
      continue;
    }
    tally.decisive++;
    if (result.winner === 0) tally.seatZero++;
    if ((result.winner === 0) === aFirst) tally.wins++;
  }
  return tally;
}
// Draws count as half a win, so mirrors read 50% by construction.
const rate = (t: Tally) => ((t.wins + t.draws / 2) / t.games) * 100;
const pct = (n: number) => `${n.toFixed(1).padStart(5)}%`;
const name = (h: Hero) => hero(h).name.replace("The ", "");

const pairs: [Hero, Hero][] = [];
HERO_IDS.forEach((a, i) => HERO_IDS.slice(i + 1).forEach((b) => pairs.push([a, b])));
const failures: string[] = [];
const started = Date.now();

// 1. The matrix that matters: every pairing, neutral theater, reading bots.
console.log("== 1v1 matchups · Kestrel Reach · reader bots ==");
const overall = emptyTally();
const byHero = new Map<Hero, { wins: number; lead: number; games: number }>(
  HERO_IDS.map((h) => [h, { wins: 0, lead: 0, games: 0 }]),
);
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}`.padStart(5);
let outsideTarget = 0;
pairs.forEach(([a, b], index) => {
  const tally = series([a], [b], games(160), 10_000 + index * 1000, {
    bot: reader,
  });
  merge(overall, tally);
  const share = rate(tally);
  const lead = tally.lead / tally.games;
  byHero.get(a)!.wins += share;
  byHero.get(a)!.lead += lead;
  byHero.get(a)!.games++;
  byHero.get(b)!.wins += 100 - share;
  byHero.get(b)!.lead -= lead;
  byHero.get(b)!.games++;
  const flag =
    Math.abs(lead) > GATE.margin
      ? "  FAIL"
      : Math.abs(lead) > TARGET.margin
        ? "  off target"
        : "";
  if (flag.includes("FAIL"))
    failures.push(`${name(a)} vs ${name(b)}: margin ${signed(lead).trim()}`);
  if (flag) outsideTarget++;
  console.log(
    `${`${name(a)} vs ${name(b)}`.padEnd(30)} margin ${signed(lead)}  bot win ${pct(share)}  avg ${(tally.turns / tally.games).toFixed(1)} turns${flag}`,
  );
});
console.log("\n== Commander strength (mean across matchups) ==");
for (const [h, s] of byHero)
  console.log(
    `${name(h).padEnd(16)} margin ${signed(s.lead / s.games)}  bot win ${pct(s.wins / s.games)}`,
  );
const seatShare = (overall.seatZero / Math.max(1, overall.decisive)) * 100;
console.log(
  `\nSeat check: team 0 won ${seatShare.toFixed(1)}% of decisive games. ` +
    `Avg ${(overall.turns / overall.games).toFixed(1)} turns ` +
    `(${((overall.onPoints / overall.games) * 100).toFixed(0)}% reach the target score), ` +
    `comebacks ${((overall.comebacks / overall.games) * 100).toFixed(1)}%, ` +
    `blowouts ${((overall.blowouts / overall.games) * 100).toFixed(1)}%, ` +
    `${outsideTarget}/${pairs.length} matchups beyond a ${TARGET.margin}-point average margin.`,
);
if (seatShare < GATE.seat[0] || seatShare > GATE.seat[1])
  failures.push(`Seat bias: team 0 wins ${seatShare.toFixed(1)}%`);

// 2. Which scoring rule actually loosens the snowball? Same games, four rule sets.
console.log("\n== Scoring rule comparison · reader bots, all pairings ==");
const variants: [string, Partial<Rules>][] = [
  ["permanent, no secure", { retain: 1, secureAfter: 0 }],
  ["permanent + secure", { retain: 1, secureAfter: 3 }],
  ["keep 1/2 + secure", { retain: 0.5, secureAfter: 3 }],
  ["secure + focus zone", { retain: 1, secureAfter: 3, focusBonus: 1 }],
];
for (const [label, rules] of variants) {
  const total = emptyTally();
  let spread = 0;
  let worst = 0;
  pairs.forEach(([a, b], index) => {
    const tally = series([a], [b], games(60), 50_000 + index * 1000, {
      bot: reader,
      rules,
    });
    merge(total, tally);
    const off = Math.abs(tally.lead / tally.games);
    spread += off;
    worst = Math.max(worst, off);
  });
  console.log(
    `${label.padEnd(22)} avg ${(total.turns / total.games).toFixed(1)} turns  ` +
      `comebacks ${pct((total.comebacks / total.games) * 100)}  ` +
      `lead changes ${(total.leadChanges / total.games).toFixed(2)}/game  ` +
      `blowouts ${pct((total.blowouts / total.games) * 100)}  ` +
      `avg margin mean ${(spread / pairs.length).toFixed(1)} max ${worst.toFixed(1)}`,
  );
}

// 3. Theaters should bend matchups, not decide them.
console.log("\n== Theaters · reader bots · widest average margin ==");
for (const theater of THEATER_IDS) {
  let worst = { label: "", lead: 0 };
  let spread = 0;
  pairs.forEach(([a, b], index) => {
    const tally = series([a], [b], games(40), 90_000 + index * 1000, {
      bot: reader,
      theater,
    });
    const lead = tally.lead / tally.games;
    spread += Math.abs(lead);
    if (Math.abs(lead) >= Math.abs(worst.lead))
      worst = { label: `${name(a)} vs ${name(b)}`, lead };
  });
  console.log(
    `${THEATERS[theater].name.padEnd(18)} avg margin mean ${(spread / pairs.length).toFixed(1)}  worst ${worst.label} ${signed(worst.lead).trim()}`,
  );
}

// 4. Four seats on one front: does it run, and how long does it take?
console.log("\n== 2v2 sample · Kestrel Reach · reader bots ==");
const squads: [Hero[], Hero[]][] = [
  [
    ["marshal", "corsair"],
    ["swarmwright", "signalist"],
  ],
  [
    ["quartermaster", "blockader"],
    ["marshal", "signalist"],
  ],
  [
    ["corsair", "blockader"],
    ["quartermaster", "swarmwright"],
  ],
  [
    ["marshal", "marshal"],
    ["corsair", "corsair"],
  ],
];
squads.forEach(([a, b], index) => {
  const tally = series(a, b, games(40), 130_000 + index * 1000, { bot: reader });
  console.log(
    `${`${a.map(name).join("+")} vs ${b.map(name).join("+")}`.padEnd(48)} margin ${signed(tally.lead / tally.games)}  bot win ${pct(rate(tally))}  avg ${(tally.turns / tally.games).toFixed(1)} turns`,
  );
});

// 5. Turn-by-turn traces of chosen pairings, for diagnosing lopsided results.
function trace(a: Hero, b: Hero, seed: number): void {
  console.log(`\n-- trace: ${name(a)} (team 0) vs ${name(b)} (team 1), seed ${seed} --`);
  let game = createGame(
    [
      { id: "a", team: 0, hero: a },
      { id: "b", team: 1, hero: b },
    ],
    seed,
  );
  const rand = seededRand(seed);
  while (game.status === "playing") {
    const hands = game.players.map((p) => p.hand.join(","));
    const plans = game.players.map((p) => [p.id, reader(game, p.id, rand)] as const);
    for (const [id, plan] of plans) game = lockAction(game, id, plan);
    game = resolveTurn(game);
    const show = (index: number) => {
      const plan = plans[index]![1];
      const cards = plan.plays.map((p) => `${p.card}>${p.zone}`).join(" ") || "pass";
      return `${cards}${plan.ability !== null ? ` +ability>${plan.ability}` : ""}`;
    };
    const turn = game.history.at(-1)!;
    console.log(
      `T${String(turn.turn).padStart(2)} A[${hands[0]}] plays ${show(0)} | B[${hands[1]}] plays ${show(1)}` +
        `\n    board ${game.board.map((z) => z.join("-")).join("  ")}  +${turn.points.join("/+")}  score ${game.scores.join("-")}`,
    );
  }
}
if (process.env.BENCH_TRACE === "1") {
  trace("marshal", "swarmwright", 7);
  trace("quartermaster", "signalist", 7);
  trace("swarmwright", "blockader", 7);
}

console.log(`\nBench took ${((Date.now() - started) / 1000).toFixed(1)}s.`);
if (failures.length) {
  // Report-only until the roster is tuned; set BENCH_ENFORCE=1 to fail the build.
  const enforce = process.env.BENCH_ENFORCE === "1";
  console.log(
    `\nBalance gate NOT met (average margin within ${GATE.margin} points)${enforce ? "" : " — report only"}:`,
  );
  for (const failure of failures) console.log(`  ${failure}`);
  if (enforce) process.exitCode = 1;
}
