import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import {
  isRuleError,
  RULESETS,
  type AnyGame,
  type MatchView,
  type Ruleset,
  type RulesetId,
  type SeatRow,
} from "./rulesets.js";
export type { MatchView } from "./rulesets.js";
interface MatchRow {
  id: string;
  code: string;
  revision: number;
  status: "lobby" | "playing" | "finished";
  ruleset: RulesetId;
  size: number;
  seats: SeatRow[];
  state: AnyGame | null;
  deadline: Date | null;
}
export interface CreateOptions {
  ruleset: RulesetId;
  /** Seats in the match: 2 for a duel, 4 for two teams of two. */
  size: number;
  /** Fill every other seat with bots and start at once. */
  bots: boolean;
}
export class StoreError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
function rules(row: Pick<MatchRow, "ruleset">): Ruleset {
  const found = RULESETS[row.ruleset];
  // A row written by a newer release than this replica: fail, do not guess.
  if (!found) throw new Error(`Unknown ruleset ${row.ruleset}`);
  return found;
}
function view(row: MatchRow, actor: string): MatchView {
  // Only a person in a seat may read a match. Bot seats belong to nobody.
  if (!row.seats.some((p) => p.id === actor && !p.bot))
    throw new StoreError(404, "Match not found.");
  return {
    id: row.id,
    code: row.code,
    revision: row.revision,
    status: row.status,
    ruleset: row.ruleset,
    size: row.size,
    host: row.seats[0]!.id,
    seats: row.seats,
    deadline: row.deadline?.toISOString() ?? null,
    you: actor,
    game: row.state ? rules(row).view(row.state, actor) : null,
  } as MatchView;
}
export class MatchStore {
  constructor(readonly pool: pg.Pool) {}
  private async transaction<T>(
    fn: (client: pg.PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL lock_timeout = '3s'");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  private async now(client: pg.PoolClient): Promise<Date> {
    return (await client.query("SELECT clock_timestamp() AS now")).rows[0]
      .now as Date;
  }
  private async save(
    client: pg.PoolClient,
    row: MatchRow,
    kind: string,
    payload: unknown,
  ) {
    row.revision++;
    await client.query(
      "UPDATE matches SET revision=$2, status=$3, seats=$4, state=$5, deadline=$6, updated_at=clock_timestamp() WHERE id=$1",
      [
        row.id,
        row.revision,
        row.status,
        JSON.stringify(row.seats),
        JSON.stringify(row.state),
        row.deadline,
      ],
    );
    await client.query(
      "INSERT INTO match_events(match_id,revision,kind,payload) VALUES ($1,$2,$3,$4)",
      [row.id, row.revision, kind, JSON.stringify(payload)],
    );
    if (row.state?.status === "finished")
      await client.query(
        "INSERT INTO result_outbox(match_id,payload) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [
          row.id,
          JSON.stringify({
            ruleset: row.state.ruleset,
            winner: row.state.winner,
            reason: row.state.reason,
            scores: row.state.scores,
            seats: row.seats,
          }),
        ],
      );
  }
  private async expire(client: pg.PoolClient, row: MatchRow, now: Date) {
    if (
      row.status !== "playing" ||
      !row.state ||
      !row.deadline ||
      row.deadline > now
    )
      return;
    // Resume one turn, giving reconnecting players a full new planning window after an outage.
    this.advance(row, now, true);
    await this.save(client, row, "turn.timeout", {
      turn: row.state.history.at(-1),
    });
  }
  /** Resolve the turn, then plan the next one for any bot seats. */
  private advance(row: MatchRow, now: Date, allowTimeout: boolean) {
    const ruleset = rules(row);
    row.state = ruleset.auto(ruleset.resolve(row.state!, allowTimeout));
    row.status = row.state.status;
    row.deadline =
      row.status === "playing"
        ? new Date(now.getTime() + ruleset.turnMs)
        : null;
  }
  /** Deal the match. Seats left empty are taken by bots where the rules allow. */
  private async begin(client: pg.PoolClient, row: MatchRow) {
    const ruleset = rules(row);
    for (const team of [0, 1] as const)
      while (row.seats.filter((p) => p.team === team).length < row.size / 2)
        row.seats.push({
          id: randomUUID(),
          hero: ruleset.heroes[randomBytes(1)[0]! % ruleset.heroes.length]!,
          team,
          bot: true,
        });
    row.state = ruleset.auto(
      ruleset.create(row.seats, randomBytes(4).readUInt32BE()),
    );
    row.status = "playing";
    row.deadline = new Date(
      (await this.now(client)).getTime() + ruleset.turnMs,
    );
    await this.save(client, row, "match.started", {
      initialState: row.state,
    });
  }
  async create(
    id: string,
    actor: string,
    hero: string,
    options: CreateOptions = { ruleset: "frontier-1", size: 2, bots: false },
  ): Promise<MatchView> {
    const ruleset = rules(options);
    if (
      !ruleset.heroes.includes(hero) ||
      !ruleset.sizes.includes(options.size) ||
      (options.bots && !ruleset.bots)
    )
      throw new StoreError(400, "Invalid request.");
    return this.transaction(async (client) => {
      // Serialize creation per actor to cap abandoned invite rooms across replicas.
      await client.query("SELECT id FROM sessions WHERE id=$1 FOR UPDATE", [
        actor,
      ]);
      const existing = (
        await client.query<MatchRow>("SELECT * FROM matches WHERE id=$1", [id])
      ).rows[0];
      if (existing) {
        if (existing.seats[0]?.id !== actor || existing.seats[0]?.hero !== hero)
          throw new StoreError(409, "Match identifier already used.");
        return view(existing, actor);
      }
      const active = await client.query(
        "SELECT count(*) FROM matches WHERE status != 'finished' AND created_at > now() - interval '1 hour' AND seats @> $1::jsonb",
        [JSON.stringify([{ id: actor }])],
      );
      if (Number(active.rows[0].count) >= 5)
        throw new StoreError(429, "You already have five recent active rooms.");
      const row = (
        await client.query<MatchRow>(
          "INSERT INTO matches(id,code,status,seats,ruleset,size) VALUES ($1,$2,'lobby',$3,$4,$5) RETURNING *",
          [
            id,
            randomBytes(5).toString("hex").toUpperCase(),
            JSON.stringify([{ id: actor, hero, team: 0 }]),
            options.ruleset,
            options.size,
          ],
        )
      ).rows[0]!;
      await this.save(client, row, "match.created", { hero, ...options });
      if (options.bots) await this.begin(client, row);
      return view(row, actor);
    });
  }
  /**
   * Take a seat by invite code. Without a team, the emptier one is chosen;
   * a friend who wants to play alongside the host asks for the host's team.
   */
  async join(
    code: string,
    actor: string,
    hero: string,
    team?: 0 | 1,
  ): Promise<MatchView> {
    return this.transaction(async (client) => {
      const row = (
        await client.query<MatchRow>(
          "SELECT * FROM matches WHERE code=$1 FOR UPDATE",
          [code],
        )
      ).rows[0];
      if (!row) throw new StoreError(404, "Room not found.");
      if (row.seats.some((p) => p.id === actor)) return view(row, actor);
      if (row.status !== "lobby" || row.seats.length >= row.size)
        throw new StoreError(409, "Room is full.");
      if (!rules(row).heroes.includes(hero))
        throw new StoreError(400, "Invalid request.");
      const taken = (t: 0 | 1) => row.seats.filter((p) => p.team === t).length;
      const side = team ?? (taken(1) < taken(0) ? 1 : 0);
      if (taken(side) >= row.size / 2)
        throw new StoreError(409, "That team is full.");
      row.seats.push({ id: actor, hero, team: side });
      if (row.seats.length === row.size) await this.begin(client, row);
      else await this.save(client, row, "seat.joined", { actor, hero, team: side });
      return view(row, actor);
    });
  }
  /** The host starts a lobby early; bots take the seats still empty. */
  async start(id: string, actor: string): Promise<MatchView> {
    return this.transaction(async (client) => {
      const row = (
        await client.query<MatchRow>(
          "SELECT * FROM matches WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!row) throw new StoreError(404, "Match not found.");
      view(row, actor);
      // A repeated start is a retry of one that already committed.
      if (row.status !== "lobby") return view(row, actor);
      if (row.seats[0]!.id !== actor)
        throw new StoreError(403, "Only the host can start the match.");
      if (!rules(row).bots)
        throw new StoreError(409, "This match needs every seat filled.");
      await this.begin(client, row);
      return view(row, actor);
    });
  }
  async get(id: string, actor: string): Promise<MatchView> {
    const row = (
      await this.pool.query<MatchRow>("SELECT * FROM matches WHERE id=$1", [id])
    ).rows[0];
    if (!row) throw new StoreError(404, "Match not found.");
    return view(row, actor);
  }
  async command(
    id: string,
    actor: string,
    commandId: string,
    turn: number,
    input: unknown,
  ): Promise<MatchView> {
    // Commit expired turns even when rejecting the late command outside the transaction.
    const result = await this.transaction(async (client) => {
      const row = (
        await client.query<MatchRow>(
          "SELECT * FROM matches WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!row) throw new StoreError(404, "Match not found.");
      view(row, actor);
      const ruleset = rules(row);
      // The action's shape depends on the match's ruleset, so it is checked here.
      const parsed = ruleset.action.safeParse(input);
      if (!parsed.success) throw new StoreError(400, "Invalid request.");
      const action = parsed.data;
      const payload = { turn, action };
      const prior = (
        await client.query(
          "SELECT payload FROM commands WHERE match_id=$1 AND player_id=$2 AND command_id=$3",
          [id, actor, commandId],
        )
      ).rows[0];
      if (prior) {
        // JSONB key order is not JSON insertion order; compare in PostgreSQL.
        const same = await client.query(
          "SELECT payload = $4::jsonb AS same FROM commands WHERE match_id=$1 AND player_id=$2 AND command_id=$3",
          [id, actor, commandId, JSON.stringify(payload)],
        );
        if (!same.rows[0].same)
          throw new StoreError(
            409,
            "Command identifier reused with different input.",
          );
        return { value: view(row, actor) };
      }
      const now = await this.now(client);
      await this.expire(client, row, now);
      if (!row.state || row.status !== "playing" || row.state.turn !== turn)
        return {
          error: new StoreError(409, "Turn changed. Refresh and plan again."),
        };
      try {
        row.state = ruleset.lock(row.state, actor, action);
      } catch (error) {
        if (isRuleError(error))
          return { error: new StoreError(409, error.message) };
        throw error;
      }
      if (row.state.players.every((p: { id: string }) => row.state!.pending[p.id]))
        this.advance(row, now, false);
      await this.save(client, row, "action.accepted", {
        actor,
        commandId,
        turn,
        action,
      });
      await client.query(
        "INSERT INTO commands(match_id,player_id,command_id,payload,revision) VALUES ($1,$2,$3,$4,$5)",
        [id, actor, commandId, JSON.stringify(payload), row.revision],
      );
      return { value: view(row, actor) };
    });
    if (result.error) throw result.error;
    return result.value!;
  }
  async tick(): Promise<void> {
    await this.transaction(async (client) => {
      const now = await this.now(client);
      const rows = await client.query<MatchRow>(
        "SELECT * FROM matches WHERE status='playing' AND deadline <= $1 ORDER BY deadline LIMIT 50 FOR UPDATE SKIP LOCKED",
        [now],
      );
      for (const row of rows.rows) await this.expire(client, row, now);
    });
  }
}
