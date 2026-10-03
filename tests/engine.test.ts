import test from "node:test";
import assert from "node:assert/strict";
import {
  createGame,
  lockAction,
  playerView,
  resolveTurn,
  type Action,
} from "../packages/game/src/engine.js";
const seats = [
  { id: "a", team: 0 as const, hero: "warden" as const },
  { id: "b", team: 1 as const, hero: "shade" as const },
];
const pass: Action = { card: null, zone: 0, ability: false };
test("deterministic replay and input immutability", () => {
  const input = createGame(seats, 123);
  const original = structuredClone(input);
  const run = () =>
    resolveTurn(
      lockAction(lockAction(input, "a", { ...pass, card: "scout" }), "b", pass),
    );
  assert.deepEqual(run(), run());
  assert.deepEqual(input, original);
  assert.equal(run().scores[0], 1);
});
test("illegal card, target, cooldown, duplicate lock, and missing player are rejected", () => {
  const game = createGame(seats, 1);
  assert.throws(() => lockAction(game, "a", { ...pass, card: "breach" }));
  assert.throws(() => lockAction(game, "a", { ...pass, zone: 5 as 0 }));
  assert.throws(() => lockAction(game, "outsider", pass));
  const locked = lockAction(game, "a", pass);
  assert.throws(() => lockAction(locked, "a", pass));
  assert.throws(() => resolveTurn(locked));
  game.players[0]!.abilityReadyTurn = 3;
  assert.throws(() => lockAction(game, "a", { ...pass, ability: true }));
});
test("hidden state is absent, including own draw order and pending action", () => {
  const game = lockAction(createGame(seats, 3), "b", {
    card: "scout",
    zone: 2,
    ability: true,
  });
  const view = playerView(game, "a");
  assert.equal(view.players[1]!.hand, undefined);
  assert.equal(view.players[1]!.locked, true);
  for (const secret of ["rng", "pending", "draw", "discard"])
    assert.equal(JSON.stringify(view).includes(`"${secret}"`), false);
  assert.throws(() => playerView(game, "outsider"));
});
test("simultaneous damage and presence are invariant to iteration order", () => {
  const game = createGame(seats, 4);
  game.turn = 4;
  game.players.forEach((p) => {
    p.hand = ["breach"];
  });
  game.board[0] = [4, 4];
  const locked = lockAction(
    lockAction(game, "a", { ...pass, card: "breach" }),
    "b",
    { ...pass, card: "breach" },
  );
  const reversed = structuredClone(locked);
  reversed.players.reverse();
  assert.deepEqual(resolveTurn(locked).board, resolveTurn(reversed).board);
  assert.deepEqual(resolveTurn(locked).board[0], [0, 0]);
});
test("timeout passes and three consecutive misses end the match", () => {
  let game = createGame(seats, 7);
  for (let i = 0; i < 3; i++)
    game = resolveTurn(lockAction(game, "a", pass), true);
  assert.equal(game.winner, 0);
  assert.equal(game.reason, "abandonment");
  assert.throws(() => resolveTurn(game, true));
});
test("both absent teams draw and active ties end at the turn cap", () => {
  let game = createGame(seats, 8);
  for (let i = 0; i < 3; i++) game = resolveTurn(game, true);
  assert.equal(game.winner, "draw");
  game = createGame(seats, 8);
  for (let i = 0; i < 16; i++)
    game = resolveTurn(lockAction(lockAction(game, "a", pass), "b", pass));
  assert.equal(game.reason, "turn-limit");
  assert.equal(game.winner, "draw");
});
test("score threshold compares both teams after resolution", () => {
  const game = createGame(seats, 8);
  game.scores = [14, 14];
  game.board = [
    [2, 0],
    [0, 2],
    [1, 1],
  ];
  const next = resolveTurn(lockAction(lockAction(game, "a", pass), "b", pass));
  assert.equal(next.winner, "draw");
  assert.equal(next.reason, "points");
});
test("four-seat teams aggregate once and one absent teammate does not forfeit a team", () => {
  let game = createGame(
    [
      ...seats,
      { id: "c", team: 0, hero: "warden" },
      { id: "d", team: 1, hero: "shade" },
    ],
    42,
  );
  for (let turn = 0; turn < 3; turn++) {
    for (const id of ["a", "b", "c"]) game = lockAction(game, id, pass);
    game = resolveTurn(game, true);
  }
  assert.equal(game.status, "playing");
  assert.equal(game.players[3]!.missed, 3);
});
test("seeded match sweep conserves cards and never produces negative presence", () => {
  for (let seed = 1; seed <= 100; seed++) {
    let game = createGame(seats, seed);
    while (game.status === "playing") {
      for (const player of game.players) {
        game = lockAction(game, player.id, {
          ...pass,
          card: player.hand.find((c) => c === "scout") ?? null,
          ability: game.turn >= player.abilityReadyTurn,
        });
      }
      game = resolveTurn(game);
      assert.ok(game.board.flat().every((n) => Number.isInteger(n) && n >= 0));
      game.players.forEach((p) =>
        assert.equal(p.hand.length + p.draw.length + p.discard.length, 12),
      );
    }
  }
});
