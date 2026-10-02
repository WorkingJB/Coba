import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createGame, lockAction, playerView, resolveTurn, RuleError, TURN_MS, type Game, type Team, type Action } from '../../../packages/game/src/engine.js';
import type { Hero } from '../../../packages/game/src/content.js';
export interface Seat { id: string; hero: Hero; team: Team }
interface MatchRow { id: string; code: string; revision: number; status: 'lobby' | 'playing' | 'finished'; seats: Seat[]; state: Game | null; deadline: Date | null }
export class StoreError extends Error { constructor(public statusCode: number, message: string) { super(message); } }
function view(row: MatchRow, actor: string) {
  if (!row.seats.some(p => p.id === actor)) throw new StoreError(404, 'Match not found.');
  return { id: row.id, code: row.code, revision: row.revision, status: row.status, seats: row.seats,
    deadline: row.deadline?.toISOString() ?? null, you: actor, game: row.state ? playerView(row.state, actor) : null };
}
export type MatchView = ReturnType<typeof view>;
export class MatchStore {
  constructor(readonly pool: pg.Pool) {}
  private async transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '3s'");
      const result = await fn(client); await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  private async now(client: pg.PoolClient): Promise<Date> { return (await client.query('SELECT clock_timestamp() AS now')).rows[0].now as Date; }
  private async save(client: pg.PoolClient, row: MatchRow, kind: string, payload: unknown) {
    row.revision++;
    await client.query('UPDATE matches SET revision=$2, status=$3, seats=$4, state=$5, deadline=$6, updated_at=clock_timestamp() WHERE id=$1',
      [row.id, row.revision, row.status, JSON.stringify(row.seats), JSON.stringify(row.state), row.deadline]);
    await client.query('INSERT INTO match_events(match_id,revision,kind,payload) VALUES ($1,$2,$3,$4)', [row.id, row.revision, kind, JSON.stringify(payload)]);
    if (row.state?.status === 'finished') await client.query('INSERT INTO result_outbox(match_id,payload) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [row.id, JSON.stringify({ ruleset: row.state.ruleset, winner: row.state.winner, reason: row.state.reason, scores: row.state.scores, seats: row.seats })]);
  }
  private async expire(client: pg.PoolClient, row: MatchRow, now: Date) {
    if (row.status !== 'playing' || !row.state || !row.deadline || row.deadline > now) return;
    // Resume one turn, giving reconnecting players a full new planning window after an outage.
    row.state = resolveTurn(row.state, true); row.status = row.state.status;
    row.deadline = row.status === 'playing' ? new Date(now.getTime() + TURN_MS) : null;
    await this.save(client, row, 'turn.timeout', { turn: row.state.history.at(-1) });
  }
  async create(id: string, actor: string, hero: Hero): Promise<MatchView> {
    return this.transaction(async client => {
      // Serialize creation per actor to cap abandoned invite rooms across replicas.
      await client.query('SELECT id FROM sessions WHERE id=$1 FOR UPDATE', [actor]);
      const existing = (await client.query<MatchRow>('SELECT * FROM matches WHERE id=$1', [id])).rows[0];
      if (existing) {
        if (existing.seats[0]?.id !== actor || existing.seats[0]?.hero !== hero) throw new StoreError(409, 'Match identifier already used.');
        return view(existing, actor);
      }
      const active = await client.query("SELECT count(*) FROM matches WHERE status != 'finished' AND created_at > now() - interval '1 hour' AND seats @> $1::jsonb", [JSON.stringify([{ id: actor }])]);
      if (Number(active.rows[0].count) >= 5) throw new StoreError(429, 'You already have five recent active rooms.');
      const row = (await client.query<MatchRow>("INSERT INTO matches(id,code,status,seats) VALUES ($1,$2,'lobby',$3) RETURNING *",
        [id, randomBytes(5).toString('hex').toUpperCase(), JSON.stringify([{ id: actor, hero, team: 0 }])])).rows[0]!;
      await this.save(client, row, 'match.created', { hero }); return view(row, actor);
    });
  }
  async join(code: string, actor: string, hero: Hero): Promise<MatchView> {
    return this.transaction(async client => {
      const row = (await client.query<MatchRow>('SELECT * FROM matches WHERE code=$1 FOR UPDATE', [code])).rows[0];
      if (!row) throw new StoreError(404, 'Room not found.');
      if (row.seats.some(p => p.id === actor)) return view(row, actor);
      if (row.status !== 'lobby' || row.seats.length !== 1) throw new StoreError(409, 'Room is full.');
      row.seats.push({ id: actor, hero, team: 1 });
      row.state = createGame(row.seats, randomBytes(4).readUInt32BE()); row.status = 'playing';
      row.deadline = new Date((await this.now(client)).getTime() + TURN_MS);
      await this.save(client, row, 'match.started', { initialState: row.state }); return view(row, actor);
    });
  }
  async get(id: string, actor: string): Promise<MatchView> {
    const row = (await this.pool.query<MatchRow>('SELECT * FROM matches WHERE id=$1', [id])).rows[0];
    if (!row) throw new StoreError(404, 'Match not found.'); return view(row, actor);
  }
  async command(id: string, actor: string, commandId: string, turn: number, action: Action): Promise<MatchView> {
    // Commit expired turns even when rejecting the late command outside the transaction.
    const result = await this.transaction(async client => {
      const row = (await client.query<MatchRow>('SELECT * FROM matches WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!row) throw new StoreError(404, 'Match not found.'); view(row, actor);
      const payload = { turn, action };
      const prior = (await client.query('SELECT payload FROM commands WHERE match_id=$1 AND player_id=$2 AND command_id=$3', [id, actor, commandId])).rows[0];
      if (prior) {
        // JSONB key order is not JSON insertion order; compare in PostgreSQL.
        const same = await client.query('SELECT payload = $4::jsonb AS same FROM commands WHERE match_id=$1 AND player_id=$2 AND command_id=$3', [id, actor, commandId, JSON.stringify(payload)]);
        if (!same.rows[0].same) throw new StoreError(409, 'Command identifier reused with different input.');
        return { value: view(row, actor) };
      }
      const now = await this.now(client); await this.expire(client, row, now);
      if (!row.state || row.status !== 'playing' || row.state.turn !== turn) return { error: new StoreError(409, 'Turn changed. Refresh and plan again.') };
      try { row.state = lockAction(row.state, actor, action); }
      catch (error) { if (error instanceof RuleError) return { error: new StoreError(409, error.message) }; throw error; }
      if (row.state.players.every(p => row.state!.pending[p.id])) {
        row.state = resolveTurn(row.state); row.status = row.state.status;
        row.deadline = row.status === 'playing' ? new Date(now.getTime() + TURN_MS) : null;
      }
      await this.save(client, row, 'action.accepted', { actor, commandId, turn, action });
      await client.query('INSERT INTO commands(match_id,player_id,command_id,payload,revision) VALUES ($1,$2,$3,$4,$5)', [id, actor, commandId, JSON.stringify(payload), row.revision]);
      return { value: view(row, actor) };
    });
    if (result.error) throw result.error; return result.value!;
  }
  async tick(): Promise<void> {
    await this.transaction(async client => {
      const now = await this.now(client);
      const rows = await client.query<MatchRow>("SELECT * FROM matches WHERE status='playing' AND deadline <= $1 ORDER BY deadline LIMIT 50 FOR UPDATE SKIP LOCKED", [now]);
      for (const row of rows.rows) await this.expire(client, row, now);
    });
  }
}
