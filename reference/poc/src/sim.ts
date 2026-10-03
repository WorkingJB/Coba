// Console harness. Two modes:
//   npm run sim          → play ONE verbose match, printing every turn.
//   npm run sim:bench    → play many silent matches, print archetype win rates.
//
// This is how you "prove the loop is fun in ~20 matches" before any graphics.

import {
  initGame,
  resolveTurn,
  checkWinCondition,
} from "./engine.js";
import { chooseAction } from "./bot.js";
import { heroDef } from "./heroes.js";
import { territoryDef } from "./territory.js";
import { makeRng } from "./rng.js";
import type { MatchResult, PlannedAction } from "./types.js";

interface MatchConfig {
  p1HeroId: string;
  p2HeroId: string;
  territoryId: string;
  seed: number;
  verbose: boolean;
}

function playMatch(cfg: MatchConfig): MatchResult {
  const rng = makeRng(cfg.seed);
  let state = initGame({
    p1HeroId: cfg.p1HeroId,
    p2HeroId: cfg.p2HeroId,
    territoryId: cfg.territoryId,
    rng,
  });

  if (cfg.verbose) console.log(state.log.join("\n"));

  let result = checkWinCondition(state);
  while (!result) {
    const a1 = chooseAction(state, "P1");
    const a2 = chooseAction(state, "P2");
    const before = state.log.length;
    state = resolveTurn(state, [a1, a2] as [PlannedAction, PlannedAction], rng);
    if (cfg.verbose) console.log(state.log.slice(before).join("\n"));
    result = checkWinCondition(state);
  }
  return result;
}

function runVerbose(): void {
  const p1 = "warden";
  const p2 = "shade";
  const territoryId = "volcanic_forge";
  console.log("=".repeat(60));
  console.log(`Coba — single match (seed 42)`);
  console.log(`P1: ${heroDef(p1).name} [${heroDef(p1).archetype}]`);
  console.log(`P2: ${heroDef(p2).name} [${heroDef(p2).archetype}]`);
  console.log(`Battlefield: ${territoryDef(territoryId).name}`);
  console.log("=".repeat(60));

  const result = playMatch({ p1HeroId: p1, p2HeroId: p2, territoryId, seed: 42, verbose: true });

  console.log("=".repeat(60));
  console.log(
    `RESULT: ${result.winner} wins by ${result.reason} after ${result.turns} turns ` +
      `(P1 ${result.finalPoints.P1} – ${result.finalPoints.P2} P2)`,
  );
  console.log("=".repeat(60));
}

function runBench(): void {
  // Full matrix: every distinct pairing (upper triangle) + mirrors.
  const roster = ["warden", "shade", "conjurer", "oracle", "magus", "blight"];
  const matchups: { a: string; b: string }[] = [];
  for (let i = 0; i < roster.length; i++) {
    for (let j = i; j < roster.length; j++) {
      matchups.push({ a: roster[i]!, b: roster[j]! });
    }
  }
  const territories = ["neutral_field", "volcanic_forge", "ancient_forest", "narrow_pass"];
  const gamesPer = 1000; // 200 was too noisy (±3.5%) to trust mirror rows; 1000 ≈ ±1.6%

  console.log("Balance bench — win rate for P1 (first listed hero)\n");
  for (const { a, b } of matchups) {
    for (const territoryId of territories) {
      let p1Wins = 0;
      let draws = 0;
      let totalTurns = 0;
      for (let i = 0; i < gamesPer; i++) {
        const r = playMatch({ p1HeroId: a, p2HeroId: b, territoryId, seed: 1000 + i, verbose: false });
        if (r.winner === "P1") p1Wins++;
        else if (r.winner === "DRAW") draws++;
        totalTurns += r.turns;
      }
      const pct = ((p1Wins / gamesPer) * 100).toFixed(1);
      const avgTurns = (totalTurns / gamesPer).toFixed(1);
      const label = `${heroDef(a).name} vs ${heroDef(b).name} @ ${territoryDef(territoryId).name}`;
      console.log(
        `${label.padEnd(48)} P1 win ${pct.padStart(5)}%  draws ${String(draws).padStart(3)}  avg ${avgTurns} turns`,
      );
    }
  }
}

const bench = process.argv.includes("--bench");
if (bench) runBench();
else runVerbose();
