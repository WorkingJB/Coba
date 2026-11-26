import { randomUUID } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { buildApp } from "../apps/api/src/app.js";
import { migrate } from "../apps/api/src/migrate.js";
import { MatchStore } from "../apps/api/src/store.js";
import {
  lockAction,
  resolveTurn,
  type Game,
} from "../packages/game/src/engine.js";
import * as frontier2 from "../packages/game/src/frontier2/engine.js";
import { lockBots } from "../packages/game/src/frontier2/bot.js";
import { card as card2 } from "../packages/game/src/frontier2/content.js";
const origin = "http://localhost:8080";
const accessKey = "cloud-ci-playtest-key";
test("durable multiplayer contract against real PostgreSQL", async (t) => {
  assert.ok(
    process.env.DATABASE_URL,
    "Integration tests require a cloud/CI PostgreSQL database.",
  );
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(pool);
  await migrate(pool);
  const first = await buildApp({
    pool,
    origin,
    accessKey,
    secureCookies: false,
  });
  const second = await buildApp({
    pool,
    origin,
    accessKey,
    secureCookies: false,
  });
  t.after(async () => {
    await first.app.close();
    await second.app.close();
    await pool.end();
  });
  async function session() {
    const response = await first.app.inject({
      method: "POST",
      url: "/api/session",
      headers: { origin },
      payload: { accessKey },
    });
    assert.equal(response.statusCode, 200);
    return {
      cookie: response.headers["set-cookie"]!.toString().split(";")[0]!,
      id: response.json().id as string,
    };
  }
  const a = await session();
  const b = await session();
  const outsider = await session();
  const id = randomUUID();
  const created = await first.app.inject({
    method: "POST",
    url: "/api/matches",
    headers: { origin, cookie: a.cookie },
    payload: { id, hero: "warden" },
  });
  assert.equal(created.statusCode, 200);
  const code = created.json().code;
  const joined = await second.app.inject({
    method: "POST",
    url: "/api/join",
    headers: { origin, cookie: b.cookie },
    payload: { code, hero: "shade" },
  });
  assert.equal(joined.statusCode, 200);
  const action = {
    commandId: randomUUID(),
    turn: 1,
    action: { card: "scout", zone: 0, ability: false },
  };
  const send = (
    app: typeof first.app,
    cookie: string,
    payload: Record<string, unknown>,
  ) =>
    app.inject({
      method: "POST",
      url: `/api/matches/${id}/actions`,
      headers: { origin, cookie },
      payload,
    });
  await t.test("authorization, CSRF and runtime validation", async () => {
    assert.equal(
      (await first.app.inject(`/api/matches/${id}`)).statusCode,
      401,
    );
    assert.equal(
      (
        await first.app.inject({
          url: `/api/matches/${id}`,
          headers: { cookie: outsider.cookie },
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await first.app.inject({
          method: "POST",
          url: `/api/matches/${id}/actions`,
          headers: { cookie: a.cookie, origin: "https://evil.example" },
          payload: action,
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await send(first.app, a.cookie, {
          ...action,
          action: { ...action.action, zone: 9 },
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await send(first.app, a.cookie, {
          ...action,
          action: { ...action.action, player: b.id },
        })
      ).statusCode,
      400,
    );
  });
  await t.test(
    "competing replicas commit exactly one lock and safely retry",
    async () => {
      const responses = await Promise.all([
        send(first.app, a.cookie, action),
        send(second.app, a.cookie, action),
      ]);
      responses.forEach((r) => assert.equal(r.statusCode, 200));
      assert.equal(
        responses[0]!.json().revision,
        responses[1]!.json().revision,
      );
      assert.equal(
        (
          await send(first.app, a.cookie, {
            ...action,
            action: { ...action.action, zone: 1 },
          })
        ).statusCode,
        409,
      );
      const enemyView = await second.app.inject({
        url: `/api/matches/${id}`,
        headers: { cookie: b.cookie },
      });
      assert.equal(enemyView.json().game.players[0].hand, undefined);
      assert.equal(enemyView.json().game.pending, undefined);
      const resolved = await send(second.app, b.cookie, {
        ...action,
        commandId: randomUUID(),
      });
      assert.equal(resolved.statusCode, 200);
      assert.equal(resolved.json().game.turn, 2);
      const retry = await send(first.app, a.cookie, action);
      assert.equal(retry.statusCode, 200);
      assert.equal(retry.json().game.turn, 2);
      assert.equal(
        (
          await send(first.app, a.cookie, {
            ...action,
            commandId: randomUUID(),
          })
        ).statusCode,
        409,
      );
    },
  );
  await t.test(
    "new server restores match without original process memory",
    async () => {
      const recovered = await buildApp({
        pool,
        origin,
        accessKey,
        secureCookies: false,
      });
      try {
        const response = await recovered.app.inject({
          url: `/api/matches/${id}`,
          headers: { cookie: a.cookie },
        });
        assert.equal(response.statusCode, 200);
        assert.equal(response.json().game.turn, 2);
      } finally {
        await recovered.app.close();
      }
    },
  );
  await t.test(
    "late action rejects while timeout persists; competing workers only advance once",
    async () => {
      await pool.query(
        "UPDATE matches SET deadline=now()-interval '1 second' WHERE id=$1",
        [id],
      );
      assert.equal(
        (
          await send(first.app, a.cookie, {
            ...action,
            commandId: randomUUID(),
            turn: 2,
          })
        ).statusCode,
        409,
      );
      assert.equal((await first.store.get(id, a.id)).game!.turn, 3);
      await pool.query(
        "UPDATE matches SET deadline=now()-interval '1 second' WHERE id=$1",
        [id],
      );
      await Promise.all([first.store.tick(), second.store.tick()]);
      assert.equal((await first.store.get(id, a.id)).game!.turn, 4);
      await pool.query(
        "UPDATE matches SET deadline=now()-interval '1 second' WHERE id=$1",
        [id],
      );
      await Promise.all([first.store.tick(), second.store.tick()]);
      assert.equal((await first.store.get(id, a.id)).status, "finished");
      assert.equal(
        Number(
          (
            await pool.query(
              "SELECT count(*) FROM result_outbox WHERE match_id=$1",
              [id],
            )
          ).rows[0].count,
        ),
        1,
      );
      await first.store.tick();
      const events = await pool.query(
        "SELECT revision FROM match_events WHERE match_id=$1 ORDER BY revision",
        [id],
      );
      assert.deepEqual(
        events.rows.map((r) => r.revision),
        Array.from({ length: events.rows.length }, (_, i) => i + 1),
      );
    },
  );
  await t.test(
    "private journal deterministically reconstructs terminal state",
    async () => {
      const events = await pool.query(
        "SELECT kind,payload FROM match_events WHERE match_id=$1 ORDER BY revision",
        [id],
      );
      let replay: Game | undefined;
      for (const event of events.rows) {
        if (event.kind === "match.started")
          replay = event.payload.initialState as Game;
        if (event.kind === "action.accepted") {
          assert.ok(replay);
          replay = lockAction(
            replay,
            event.payload.actor,
            event.payload.action,
          );
          if (replay.players.every((p) => replay!.pending[p.id]))
            replay = resolveTurn(replay);
        }
        if (event.kind === "turn.timeout") {
          assert.ok(replay);
          replay = resolveTurn(replay, true);
        }
      }
      const saved = (
        await pool.query("SELECT state FROM matches WHERE id=$1", [id])
      ).rows[0].state;
      assert.deepEqual(replay, saved);
    },
  );
  await t.test("simultaneous different-player locks resolve once", async () => {
    const fresh = randomUUID();
    const room = await first.store.create(fresh, a.id, "warden");
    await second.store.join(room.code, b.id, "shade");
    const pass = { card: null, zone: 0 as const, ability: false };
    await Promise.all([
      first.store.command(fresh, a.id, randomUUID(), 1, pass),
      second.store.command(fresh, b.id, randomUUID(), 1, pass),
    ]);
    const result = await new MatchStore(pool).get(fresh, a.id);
    assert.equal(result.game!.turn, 2);
    assert.equal(result.game!.history.length, 1);
  });
});

test("frontier-2 through the API: bot seats, four-seat lobbies, team views", async (t) => {
  assert.ok(process.env.DATABASE_URL);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(pool);
  const first = await buildApp({ pool, origin, accessKey, secureCookies: false });
  const second = await buildApp({ pool, origin, accessKey, secureCookies: false });
  t.after(async () => {
    await first.app.close();
    await second.app.close();
    await pool.end();
  });
  async function session() {
    const response = await first.app.inject({
      method: "POST",
      url: "/api/session",
      headers: { origin },
      payload: { accessKey },
    });
    return {
      cookie: response.headers["set-cookie"]!.toString().split(";")[0]!,
      id: response.json().id as string,
    };
  }
  const post = (
    app: typeof first.app,
    who: { cookie: string },
    url: string,
    payload: Record<string, unknown>,
  ) =>
    app.inject({
      method: "POST",
      url: `/api/${url}`,
      headers: { origin, cookie: who.cookie },
      payload,
    });
  const read = async (app: typeof first.app, who: { cookie: string }, id: string) =>
    (
      await app.inject({
        url: `/api/matches/${id}`,
        headers: { cookie: who.cookie },
      })
    ).json();
  const pass = { plays: [], ability: null };

  await t.test("creation is validated against the chosen ruleset", async () => {
    const a = await session();
    const bad = [
      { hero: "warden", ruleset: "frontier-2" },
      { hero: "marshal", ruleset: "frontier-1" },
      { hero: "warden", ruleset: "frontier-1", size: 4 },
      { hero: "warden", ruleset: "frontier-1", bots: true },
      { hero: "marshal", ruleset: "frontier-3" },
      { hero: "marshal", ruleset: "frontier-2", size: 3 },
    ];
    for (const payload of bad)
      assert.equal(
        (await post(first.app, a, "matches", { id: randomUUID(), ...payload }))
          .statusCode,
        400,
        JSON.stringify(payload),
      );
  });

  await t.test("a solo match against a bot plays to the end and replays", async () => {
    const a = await session();
    const id = randomUUID();
    const body = { id, hero: "marshal", ruleset: "frontier-2", bots: true };
    const created = await post(first.app, a, "matches", body);
    assert.equal(created.statusCode, 200);
    let match = created.json();
    assert.equal(match.status, "playing");
    assert.equal(match.ruleset, "frontier-2");
    assert.equal(match.seats.length, 2);
    // A retried create returns the same match rather than dealing a second one.
    const again = await post(second.app, a, "matches", body);
    assert.equal(again.json().revision, match.revision);
    const me = match.game.players.find((p: { id: string }) => p.id === a.id);
    const bot = match.game.players.find((p: { id: string }) => p.id !== a.id);
    assert.equal(bot.bot, true);
    assert.equal(bot.locked, true);
    assert.equal(bot.hand, undefined);
    assert.equal(bot.plan, undefined);
    assert.equal(match.game.pending, undefined);
    const send = (action: unknown, turn: number) =>
      post(first.app, a, `matches/${id}/actions`, {
        commandId: randomUUID(),
        turn,
        action,
      });
    // Shape errors are the caller's fault; rule errors are a conflict.
    for (const action of [
      { card: null, zone: 0, ability: false },
      { plays: [{ card: "scout", zone: 0 }], ability: null },
      { plays: [{ card: "marines", zone: 3 }], ability: null },
      { plays: Array(4).fill({ card: "marines", zone: 0 }), ability: null },
      { plays: [], ability: null, player: bot.id },
      undefined,
    ])
      assert.equal((await send(action, 1)).statusCode, 400, JSON.stringify(action));
    assert.equal(
      (await send({ plays: [{ card: "dreadnought", zone: 0 }], ability: null }, 1))
        .statusCode,
      409,
    );
    const opener = me.hand.find((c: string) => card2(c as never).cost <= 1);
    const played = await send(
      { plays: [{ card: opener, zone: 1 }], ability: 1 },
      1,
    );
    assert.equal(played.statusCode, 200);
    match = played.json();
    // The bot had already planned, so one command resolves the turn.
    assert.equal(match.game.turn, 2);
    assert.equal(match.game.history.length, 1);
    assert.equal(match.game.history[0].actions.length, 2);
    assert.ok(match.game.history[0].events.length > 0);
    assert.ok(match.deadline);
    while (match.status === "playing") {
      const next = await send(pass, match.game.turn);
      assert.equal(next.statusCode, 200);
      match = next.json();
    }
    assert.equal(match.game.winner, bot.team);
    assert.equal(match.deadline, null);
    const outbox = await pool.query(
      "SELECT payload FROM result_outbox WHERE match_id=$1",
      [id],
    );
    assert.equal(outbox.rows.length, 1);
    assert.equal(outbox.rows[0].payload.ruleset, "frontier-2");
    // The journal holds only what people did; bot plans are recomputed.
    const events = await pool.query(
      "SELECT kind,payload FROM match_events WHERE match_id=$1 ORDER BY revision",
      [id],
    );
    let replay: frontier2.Game | undefined;
    for (const event of events.rows) {
      if (event.kind === "match.started") replay = event.payload.initialState;
      if (event.kind === "action.accepted") {
        assert.ok(replay);
        replay = frontier2.lockAction(
          replay,
          event.payload.actor,
          event.payload.action,
        );
        if (replay.players.every((p) => replay!.pending[p.id]))
          replay = lockBots(frontier2.resolveTurn(replay));
      }
    }
    const saved = (
      await pool.query("SELECT state FROM matches WHERE id=$1", [id])
    ).rows[0].state;
    assert.deepEqual(replay, saved);
  });

  await t.test("a four-seat lobby seats teams, starts early with bots, and shares plans", async () => {
    const host = await session();
    const friend = await session();
    const rival = await session();
    const late = await session();
    const id = randomUUID();
    const created = await post(first.app, host, "matches", {
      id,
      hero: "quartermaster",
      ruleset: "frontier-2",
      size: 4,
    });
    assert.equal(created.statusCode, 200);
    const { code } = created.json();
    assert.equal(created.json().status, "lobby");
    assert.equal(created.json().size, 4);
    assert.equal(
      (await post(first.app, friend, "join", { code, hero: "warden" })).statusCode,
      400,
    );
    const beside = await post(second.app, friend, "join", {
      code,
      hero: "swarmwright",
      team: 0,
    });
    assert.equal(beside.statusCode, 200);
    assert.equal(beside.json().status, "lobby");
    assert.equal(
      (await post(first.app, rival, "join", { code, hero: "corsair", team: 0 }))
        .statusCode,
      409,
    );
    // No team asked for: the emptier side.
    const across = await post(first.app, rival, "join", { code, hero: "corsair" });
    assert.equal(across.json().seats.at(-1).team, 1);
    assert.equal(
      (await post(first.app, friend, `matches/${id}/start`, {})).statusCode,
      403,
    );
    assert.equal(
      (await post(first.app, late, `matches/${id}/start`, {})).statusCode,
      404,
    );
    const started = await post(second.app, host, `matches/${id}/start`, {});
    assert.equal(started.statusCode, 200);
    const match = started.json();
    assert.equal(match.status, "playing");
    assert.equal(match.seats.length, 4);
    const bots = match.seats.filter((p: { bot?: boolean }) => p.bot);
    assert.equal(bots.length, 1);
    assert.equal(bots[0].team, 1);
    assert.equal(
      (await post(first.app, host, `matches/${id}/start`, {})).json().revision,
      match.revision,
    );
    assert.equal(
      (await post(first.app, late, "join", { code, hero: "marshal" })).statusCode,
      409,
    );
    // The host locks. A teammate sees the plan; the rival sees only the lock.
    const plan = { plays: [], ability: 2 };
    const locked = await post(first.app, host, `matches/${id}/actions`, {
      commandId: randomUUID(),
      turn: 1,
      action: plan,
    });
    assert.equal(locked.statusCode, 200);
    assert.equal(locked.json().game.turn, 1);
    const seat = (view: { game: { players: { id: string }[] } }) =>
      view.game.players.find((p) => p.id === host.id) as Record<string, unknown>;
    assert.deepEqual(seat(await read(second.app, friend, id)).plan, plan);
    const theirs = await read(first.app, rival, id);
    assert.equal(seat(theirs).locked, true);
    assert.equal(JSON.stringify(theirs).includes('"plan"'), false);
    assert.equal(JSON.stringify(theirs).includes('"hand":'), true);
    assert.equal(seat(theirs).hand, undefined);
    // The others run out the clock: the turn resolves once, bots re-plan.
    await pool.query(
      "UPDATE matches SET deadline=now()-interval '1 second' WHERE id=$1",
      [id],
    );
    await Promise.all([first.store.tick(), second.store.tick()]);
    const after = await read(first.app, friend, id);
    assert.equal(after.game.turn, 2);
    assert.equal(after.game.history.length, 1);
    const reveal = after.game.history[0].actions;
    assert.deepEqual(
      reveal.map((r: { timedOut: boolean }) => r.timedOut).sort(),
      [false, false, true, true],
    );
    assert.equal(
      after.game.players.find((p: { bot: boolean }) => p.bot).locked,
      true,
    );
  });
});
