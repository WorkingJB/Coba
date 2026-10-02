import { randomUUID } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { buildApp } from '../apps/api/src/app.js';
import { migrate } from '../apps/api/src/migrate.js';
import { MatchStore } from '../apps/api/src/store.js';
const origin = 'http://localhost:8080';
const accessKey = 'cloud-ci-playtest-key';
test('durable multiplayer contract against real PostgreSQL', async t => {
  assert.ok(process.env.DATABASE_URL, 'Integration tests require a cloud/CI PostgreSQL database.');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(pool); await migrate(pool);
  const first = await buildApp({ pool, origin, accessKey, secureCookies: false });
  const second = await buildApp({ pool, origin, accessKey, secureCookies: false });
  t.after(async () => { await first.app.close(); await second.app.close(); await pool.end(); });
  async function session() {
    const response = await first.app.inject({ method: 'POST', url: '/api/session', headers: { origin }, payload: { accessKey } });
    assert.equal(response.statusCode, 200);
    return { cookie: response.headers['set-cookie']!.toString().split(';')[0]!, id: response.json().id as string };
  }
  const a = await session(); const b = await session(); const outsider = await session();
  const id = randomUUID();
  const created = await first.app.inject({ method: 'POST', url: '/api/matches', headers: { origin, cookie: a.cookie }, payload: { id, hero: 'warden' } });
  assert.equal(created.statusCode, 200); const code = created.json().code;
  const joined = await second.app.inject({ method: 'POST', url: '/api/join', headers: { origin, cookie: b.cookie }, payload: { code, hero: 'shade' } });
  assert.equal(joined.statusCode, 200);
  const action = { commandId: randomUUID(), turn: 1, action: { card: 'scout', zone: 0, ability: false } };
  const send = (app: typeof first.app, cookie: string, payload: unknown) => app.inject({ method: 'POST', url: `/api/matches/${id}/actions`, headers: { origin, cookie }, payload });
  await t.test('authorization, CSRF and runtime validation', async () => {
    assert.equal((await first.app.inject(`/api/matches/${id}`)).statusCode, 401);
    assert.equal((await first.app.inject({ url: `/api/matches/${id}`, headers: { cookie: outsider.cookie } })).statusCode, 404);
    assert.equal((await first.app.inject({ method: 'POST', url: `/api/matches/${id}/actions`, headers: { cookie: a.cookie, origin: 'https://evil.example' }, payload: action })).statusCode, 403);
    assert.equal((await send(first.app, a.cookie, { ...action, action: { ...action.action, zone: 9 } })).statusCode, 400);
    assert.equal((await send(first.app, a.cookie, { ...action, action: { ...action.action, player: b.id } })).statusCode, 400);
  });
  await t.test('competing replicas commit exactly one lock and safely retry', async () => {
    const responses = await Promise.all([send(first.app, a.cookie, action), send(second.app, a.cookie, action)]);
    responses.forEach(r => assert.equal(r.statusCode, 200));
    assert.equal(responses[0]!.json().revision, responses[1]!.json().revision);
    assert.equal((await send(first.app, a.cookie, { ...action, action: { ...action.action, zone: 1 } })).statusCode, 409);
    const enemyView = await second.app.inject({ url: `/api/matches/${id}`, headers: { cookie: b.cookie } });
    assert.equal(enemyView.json().game.players[0].hand, undefined);
    assert.equal(enemyView.json().game.pending, undefined);
    const resolved = await send(second.app, b.cookie, { ...action, commandId: randomUUID() });
    assert.equal(resolved.statusCode, 200); assert.equal(resolved.json().game.turn, 2);
    const retry = await send(first.app, a.cookie, action);
    assert.equal(retry.statusCode, 200); assert.equal(retry.json().game.turn, 2);
    assert.equal((await send(first.app, a.cookie, { ...action, commandId: randomUUID() })).statusCode, 409);
  });
  await t.test('new server restores match without original process memory', async () => {
    const recovered = await buildApp({ pool, origin, accessKey, secureCookies: false });
    try {
      const response = await recovered.app.inject({ url: `/api/matches/${id}`, headers: { cookie: a.cookie } });
      assert.equal(response.statusCode, 200); assert.equal(response.json().game.turn, 2);
    } finally { await recovered.app.close(); }
  });
  await t.test('late action rejects while timeout persists; competing workers only advance once', async () => {
    await pool.query("UPDATE matches SET deadline=now()-interval '1 second' WHERE id=$1", [id]);
    assert.equal((await send(first.app, a.cookie, { ...action, commandId: randomUUID(), turn: 2 })).statusCode, 409);
    assert.equal((await first.store.get(id, a.id)).game!.turn, 3);
    await pool.query("UPDATE matches SET deadline=now()-interval '1 second' WHERE id=$1", [id]);
    await Promise.all([first.store.tick(), second.store.tick()]);
    assert.equal((await first.store.get(id, a.id)).game!.turn, 4);
    await pool.query("UPDATE matches SET deadline=now()-interval '1 second' WHERE id=$1", [id]);
    await Promise.all([first.store.tick(), second.store.tick()]);
    assert.equal((await first.store.get(id, a.id)).status, 'finished');
    assert.equal(Number((await pool.query('SELECT count(*) FROM result_outbox WHERE match_id=$1', [id])).rows[0].count), 1);
    await first.store.tick();
    const events = await pool.query('SELECT revision FROM match_events WHERE match_id=$1 ORDER BY revision', [id]);
    assert.deepEqual(events.rows.map(r => r.revision), Array.from({ length: events.rows.length }, (_, i) => i + 1));
  });
  await t.test('simultaneous different-player locks resolve once', async () => {
    const fresh = randomUUID();
    const room = await first.store.create(fresh, a.id, 'warden');
    await second.store.join(room.code, b.id, 'shade');
    const pass = { card: null, zone: 0 as const, ability: false };
    await Promise.all([first.store.command(fresh, a.id, randomUUID(), 1, pass), second.store.command(fresh, b.id, randomUUID(), 1, pass)]);
    const result = await new MatchStore(pool).get(fresh, a.id);
    assert.equal(result.game!.turn, 2); assert.equal(result.game!.history.length, 1);
  });
});
