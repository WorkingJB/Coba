import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  lockAction,
  playerView,
  resolveTurn,
  simulate,
  type Action,
  type Game,
  type Seat,
} from "../packages/game/src/frontier2/engine.js";
import {
  CARD_IDS,
  HERO_IDS,
  card,
  describe,
  hero,
} from "../packages/game/src/frontier2/content.js";
import {
  greedy,
  reader,
  seededRand,
} from "../packages/game/src/frontier2/bot.js";

const seats: Seat[] = [
  { id: "a", team: 0, hero: "marshal" },
  { id: "b", team: 1, hero: "corsair" },
];
const pass: Action = { plays: [], ability: null };
/** A mid-game position with chosen hands, so effects can be checked by hand. */
function position(setup: (game: Game) => void): Game {
  const game = createGame(seats, 9);
  game.turn = 6;
  setup(game);
  return game;
}
const both = (game: Game, a: Action, b: Action) =>
  resolveTurn(lockAction(lockAction(game, "a", a), "b", b));

test("content is well formed", () => {
  for (const id of HERO_IDS) {
    assert.equal(hero(id).deck.length, 12);
    assert.ok(hero(id).deck.filter((c) => card(c).cost === 1).length >= 2);
    assert.ok(describe(hero(id).ability).length > 0);
  }
  for (const id of CARD_IDS) assert.ok(describe(card(id)).length > 0);
});

test("deterministic replay and input immutability", () => {
  const input = createGame(seats, 123);
  const original = structuredClone(input);
  const opener = input.players[0]!.hand.find((c) => card(c).cost === 1)!;
  const run = () =>
    both(input, { plays: [{ card: opener, zone: 1 }], ability: null }, pass);
  assert.deepEqual(run(), run());
  assert.deepEqual(input, original);
  assert.equal(run().scores[0], 1);
});

test("every opening hand can act on turn one", () => {
  for (let seed = 1; seed <= 200; seed++)
    for (const player of createGame(seats, seed).players) {
      assert.equal(player.hand.length, 4);
      assert.ok(player.hand.some((c) => card(c).cost <= 1));
    }
});

test("plans are limited by hand, energy, play count, zone and cooldown", () => {
  const game = position((g) => {
    g.players[0]!.hand = ["marines", "gunship", "frigate", "cruiser"];
  });
  const plan = (...cards: Action["plays"]) => ({ plays: cards, ability: null });
  // 1 + 2 + 3 fits six energy.
  lockAction(
    game,
    "a",
    plan(
      { card: "marines", zone: 0 },
      { card: "gunship", zone: 1 },
      { card: "frigate", zone: 2 },
    ),
  );
  // 3 + 4 does not.
  assert.throws(() =>
    lockAction(
      game,
      "a",
      plan({ card: "frigate", zone: 0 }, { card: "cruiser", zone: 0 }),
    ),
  );
  // Only one Marine Squad is in hand.
  assert.throws(() =>
    lockAction(
      game,
      "a",
      plan({ card: "marines", zone: 0 }, { card: "marines", zone: 1 }),
    ),
  );
  assert.throws(() =>
    lockAction(game, "a", plan({ card: "dreadnought", zone: 0 })),
  );
  assert.throws(() =>
    lockAction(game, "a", plan({ card: "marines", zone: 7 as 0 })),
  );
  assert.throws(() =>
    lockAction(game, "a", plan({ card: "nonsense" as "marines", zone: 0 })),
  );
  game.rules.maxPlays = 1;
  assert.throws(() =>
    lockAction(
      game,
      "a",
      plan({ card: "marines", zone: 0 }, { card: "gunship", zone: 1 }),
    ),
  );
  game.players[0]!.abilityReadyTurn = 8;
  assert.throws(() => lockAction(game, "a", { plays: [], ability: 0 }));
  assert.throws(() => lockAction(game, "outsider", pass));
  const locked = lockAction(game, "a", pass);
  assert.throws(() => lockAction(locked, "a", pass));
  assert.throws(() => resolveTurn(locked));
});

test("several cards resolve in one turn and leave the hand", () => {
  const game = position((g) => {
    g.players[0]!.hand = ["marines", "gunship", "frigate"];
  });
  const next = both(
    game,
    {
      plays: [
        { card: "marines", zone: 0 },
        { card: "gunship", zone: 0 },
        { card: "frigate", zone: 2 },
      ],
      ability: null,
    },
    pass,
  );
  assert.deepEqual(next.board, [
    [6, 0],
    [0, 0],
    [6, 0],
  ]);
  assert.deepEqual(next.history[0]!.points, [2, 0]);
  const me = next.players[0]!;
  assert.deepEqual(me.discard, ["marines", "gunship", "frigate"]);
  assert.equal(me.hand.length, 2); // emptied, then drew two
});

test("a shield blocks removal, and only this turn", () => {
  const game = position((g) => {
    g.board[1] = [5, 0];
    g.players[0]!.hand = ["pdgrid"];
    g.players[1]!.hand = ["torpedo"];
  });
  // Torpedo Run removes 5; Point-Defense Grid adds 4 and blocks 6.
  const shielded = both(
    game,
    { plays: [{ card: "pdgrid", zone: 1 }], ability: null },
    { plays: [{ card: "torpedo", zone: 1 }], ability: null },
  );
  assert.deepEqual(shielded.board[1], [9, 2]);
  const strike = shielded.history[0]!.events.find((e) => e.kind === "strike");
  assert.deepEqual(strike, {
    kind: "strike",
    zone: 1,
    team: 0,
    amount: 0,
    blocked: 5,
    ambush: false,
  });
  // The same strike into an unshielded zone lands in full.
  const open = both(game, pass, {
    plays: [{ card: "torpedo", zone: 1 }],
    ability: null,
  });
  assert.deepEqual(open.board[1], [0, 2]);
});

test("ambush only springs where the enemy deployed a unit", () => {
  const game = position((g) => {
    g.board[0] = [6, 0];
    g.board[2] = [6, 0];
    g.players[0]!.hand = ["gunship"];
    g.players[1]!.hand = ["boarding", "boarding"];
  });
  // Boarding Action removes 2, or 4 where a unit just arrived, and seizes 1.
  const next = both(
    game,
    { plays: [{ card: "gunship", zone: 0 }], ability: null },
    {
      plays: [
        { card: "boarding", zone: 0 },
        { card: "boarding", zone: 2 },
      ],
      ability: null,
    },
  );
  assert.deepEqual(next.board[0], [6, 1]); // 6 + 4 - (2 + 2)
  assert.deepEqual(next.board[2], [4, 1]); // 6 - 2
});

test("amplify scales this turn's deployments; percentage strikes measure the result", () => {
  const amplified = createGame(
    [
      { id: "a", team: 0, hero: "quartermaster" },
      { id: "b", team: 1, hero: "signalist" },
    ],
    5,
  );
  amplified.turn = 6;
  amplified.board[1] = [5, 0];
  amplified.players[0]!.hand = ["gunship", "resupply"];
  amplified.players[1]!.hand = ["spoof"];
  // Deploys 4 + 2 = 6, arriving 50% stronger (+3): 5 + 9 = 14.
  // Spoof strips floor(14 * 0.3) = 4 and seizes 1.
  const next = both(
    amplified,
    {
      plays: [
        { card: "gunship", zone: 1 },
        { card: "resupply", zone: 1 },
      ],
      ability: null,
    },
    { plays: [{ card: "spoof", zone: 1 }], ability: null },
  );
  assert.deepEqual(next.board[1], [10, 1]);
});

test("resolution does not depend on player order", () => {
  const game = position((g) => {
    g.board[0] = [4, 4];
    g.players.forEach((p) => {
      p.hand = ["torpedo"];
    });
  });
  const locked = lockAction(
    lockAction(game, "a", {
      plays: [{ card: "torpedo", zone: 0 }],
      ability: null,
    }),
    "b",
    { plays: [{ card: "torpedo", zone: 0 }], ability: null },
  );
  const reversed = structuredClone(locked);
  reversed.players.reverse();
  assert.deepEqual(resolveTurn(locked).board, resolveTurn(reversed).board);
  // Each side removes 5 of the other's 4 + 2.
  assert.deepEqual(resolveTurn(locked).board[0], [1, 1]);
});

test("holding a zone three turns secures it: bonus, then the zone reopens", () => {
  let game = position((g) => {
    g.board[1] = [9, 2];
  });
  game = both(game, pass, pass);
  game = both(game, pass, pass);
  assert.deepEqual(game.holds[1], { team: 0, streak: 2 });
  assert.equal(game.scores[0], 2);
  game = both(game, pass, pass);
  assert.equal(game.scores[0], 5); // third point, plus two for securing
  assert.deepEqual(game.board[1], [0, 0]);
  assert.deepEqual(game.holds[1], { team: null, streak: 0 });
  assert.ok(game.history.at(-1)!.events.some((e) => e.kind === "secure"));
});

test("losing the lead restarts the hold streak for the new leader", () => {
  let game = position((g) => {
    g.board[1] = [3, 0];
    g.players[1]!.hand = ["marines", "sabotage"];
  });
  game = both(game, pass, pass);
  assert.equal(game.holds[1]!.streak, 1);
  // Sabotage removes 1 and seizes 1, Marines add 2: 2 against 3.
  game = both(game, pass, {
    plays: [
      { card: "sabotage", zone: 1 },
      { card: "marines", zone: 1 },
    ],
    ability: null,
  });
  assert.deepEqual(game.board[1], [2, 3]);
  assert.deepEqual(game.holds[1], { team: 1, streak: 1 });
});

test("the focus zone is public, rotates, and pays extra when enabled", () => {
  const game = createGame(seats, 11, {
    rules: { focusBonus: 1, secureAfter: 0 },
  });
  const view = playerView(game, "a");
  assert.ok(view.focus !== null && view.nextFocus !== null);
  assert.notEqual(view.focus, view.nextFocus);
  game.board[view.focus!] = [3, 0];
  const next = both(game, pass, pass);
  assert.equal(next.scores[0], 2);
  assert.equal(playerView(createGame(seats, 11), "a").focus, null);
});

test("hidden state never reaches another player", () => {
  const start = createGame(seats, 3);
  const opener = start.players[1]!.hand.find((c) => card(c).cost === 1)!;
  const game = lockAction(start, "b", {
    plays: [{ card: opener, zone: 2 }],
    ability: 2,
  });
  const view = playerView(game, "a");
  assert.equal(view.players[1]!.hand, undefined);
  assert.equal(view.players[1]!.locked, true);
  assert.equal(view.players[0]!.hand!.length, 4);
  for (const secret of ["rng", "pending", "draw", "discard", "focusOffset"])
    assert.equal(JSON.stringify(view).includes(`"${secret}"`), false);
  assert.throws(() => playerView(game, "outsider"));
});

test("timeouts pass, three misses forfeit, and the turn cap ends a tied match", () => {
  let game = createGame(seats, 7);
  for (let i = 0; i < 3; i++)
    game = resolveTurn(lockAction(game, "a", pass), true);
  assert.equal(game.winner, 0);
  assert.equal(game.reason, "abandonment");
  assert.throws(() => resolveTurn(game, true));
  game = createGame(seats, 8);
  for (let i = 0; i < game.rules.maxTurns; i++) game = both(game, pass, pass);
  assert.equal(game.reason, "turn-limit");
  assert.equal(game.winner, "draw");
});

test("four seats share one front and one absent teammate does not forfeit", () => {
  let game = createGame(
    [
      ...seats,
      { id: "c", team: 0, hero: "swarmwright" },
      { id: "d", team: 1, hero: "signalist" },
    ],
    42,
  );
  game.turn = 6;
  game.players[0]!.hand = ["gunship"];
  game.players[2]!.hand = ["gunship"];
  game = lockAction(game, "a", {
    plays: [{ card: "gunship", zone: 1 }],
    ability: null,
  });
  game = lockAction(game, "c", {
    plays: [{ card: "gunship", zone: 1 }],
    ability: null,
  });
  game = resolveTurn(lockAction(game, "b", pass), true);
  assert.deepEqual(game.board[1], [8, 0]);
  for (let turn = 0; turn < 2; turn++) {
    for (const id of ["a", "b", "c"]) game = lockAction(game, id, pass);
    game = resolveTurn(game, true);
  }
  assert.equal(game.status, "playing");
  assert.equal(game.players[3]!.missed, 3);
});

test("simulate reports what resolveTurn commits", () => {
  const game = position((g) => {
    g.board[0] = [4, 1];
    g.players[0]!.hand = ["frigate"];
  });
  const plan: Action = { plays: [{ card: "frigate", zone: 2 }], ability: 0 };
  const preview = simulate(game, { a: plan });
  const committed = both(game, plan, pass);
  assert.deepEqual(preview.board, committed.board);
  assert.deepEqual(preview.holds, committed.holds);
  assert.deepEqual(preview.points, committed.history[0]!.points);
});

test("bots finish legal matches in every seat count and conserve cards", () => {
  const rosters: Seat[][] = [
    seats,
    [
      { id: "a", team: 0, hero: "quartermaster" },
      { id: "b", team: 1, hero: "blockader" },
      { id: "c", team: 0, hero: "swarmwright" },
      { id: "d", team: 1, hero: "signalist" },
    ],
  ];
  for (const roster of rosters)
    for (const bot of [greedy, reader])
      for (let seed = 1; seed <= 12; seed++) {
        let game = createGame(roster, seed);
        const rand = seededRand(seed);
        while (game.status === "playing") {
          const plans = game.players.map(
            (p) => [p.id, bot(game, p.id, rand)] as const,
          );
          // lockAction validates, so an illegal bot plan fails here.
          for (const [id, plan] of plans) game = lockAction(game, id, plan);
          game = resolveTurn(game);
          assert.ok(
            game.board.flat().every((n) => Number.isInteger(n) && n >= 0),
          );
          for (const p of game.players)
            assert.equal(p.hand.length + p.draw.length + p.discard.length, 12);
        }
        assert.ok(game.history.length <= game.rules.maxTurns);
      }
});
