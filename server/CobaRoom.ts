// Authoritative match room. This is Build Sequence step 4: networked
// simultaneous-turn lock/resolution. It reuses the SAME pure engine the
// simulator and web client use (src/engine.ts) — the server is the authority,
// so resolution only ever happens here, never on a client.

// colyseus is CommonJS — its classes live on module.exports but Node's ESM
// named-export lexer can't see them, so default-import and destructure.
import colyseus from "colyseus";
import type { Client } from "colyseus";
import { initGame, resolveTurn, checkWinCondition } from "../src/engine.js";

const { Room } = colyseus;
import { HERO_IDS } from "../src/heroes.js";
import {
  type GameState,
  type PlannedAction,
  type PlayerId,
  PLAYER_IDS,
} from "../src/types.js";
import { makeRng, type Rng } from "../src/rng.js";

const DEFAULT_HERO = "shade";
const DEFAULT_TERRITORY = "neutral_field";

// How long (seconds) a seat is held open after an unexpected disconnect before
// the match is awarded as abandoned. The client retries within this window.
const RECONNECT_WINDOW = 30;

interface JoinOptions {
  code?: string;
  hero?: string;
  territory?: string;
}

type Phase = "lobby" | "playing" | "ended";

/**
 * Strip the opponent's hidden information before sending state to a client.
 * Their already-played cards are public (they're in the log), but their hand,
 * draw and discard piles are not — blank them so a client can't peek via the
 * network. The client never renders the opponent's hand, so this loses nothing.
 */
function redactFor(state: GameState, seat: PlayerId): GameState {
  const view = structuredClone(state);
  for (const pid of PLAYER_IDS) {
    if (pid === seat) continue;
    const p = view.players[pid];
    // Preserve count (some UI may show "N cards") but not identities/order.
    p.hand = p.hand.map(() => "hidden");
    p.draw = p.draw.map(() => "hidden");
    p.discard = p.discard.map(() => "hidden");
  }
  return view;
}

export class CobaRoom extends Room {
  private code = "";
  private phase: Phase = "lobby";
  private rng!: Rng;
  private game: GameState | null = null;

  /** sessionId -> seat. First to join is P1 (host), second is P2. */
  private seats = new Map<string, PlayerId>();
  private heroChoice: Record<PlayerId, string> = { P1: DEFAULT_HERO, P2: DEFAULT_HERO };
  private territoryId = DEFAULT_TERRITORY;
  private pending: Record<PlayerId, PlannedAction | null> = { P1: null, P2: null };
  /** Seats that have voted to rematch while phase === "ended". */
  private rematchVotes = new Set<PlayerId>();

  override onCreate(options: JoinOptions): void {
    this.maxClients = 2;
    this.autoDispose = true;
    this.code = options.code ?? "----";
    // Server owns the RNG: clients never seed or resolve. Math.random here is
    // fine — the determinism constraint is the engine's, and the engine takes
    // whatever seed we hand it.
    this.rng = makeRng(Math.floor(Math.random() * 1_000_000_000));
    if (options.territory) this.territoryId = options.territory;
    this.setMetadata({ code: this.code });

    this.onMessage("lock", (client, action: PlannedAction) => this.onLock(client, action));
    this.onMessage("rematch", (client) => this.onRematch(client));
  }

  override onJoin(client: Client, options: JoinOptions): void {
    const seat: PlayerId = this.seats.size === 0 ? "P1" : "P2";
    this.seats.set(client.sessionId, seat);
    this.heroChoice[seat] = options.hero && HERO_IDS.includes(options.hero) ? options.hero : DEFAULT_HERO;
    if (seat === "P1" && options.territory) this.territoryId = options.territory;

    client.send("seat", { seat, code: this.code });
    this.broadcastLobby();

    if (this.seats.size === 2) this.startMatch();
  }

  private broadcastLobby(): void {
    this.broadcast("lobby", {
      code: this.code,
      players: this.seats.size,
      heroes: this.heroChoice,
      territory: this.territoryId,
    });
  }

  private startMatch(): void {
    this.game = initGame({
      p1HeroId: this.heroChoice.P1,
      p2HeroId: this.heroChoice.P2,
      territoryId: this.territoryId,
      rng: this.rng,
    });
    this.phase = "playing";
    this.pending = { P1: null, P2: null };
    this.rematchVotes.clear();
    this.lock(); // no late joiners
    this.broadcastState();
  }

  private onLock(client: Client, action: PlannedAction): void {
    if (this.phase !== "playing" || !this.game) return;
    const seat = this.seats.get(client.sessionId);
    if (!seat || this.pending[seat]) return; // unknown client, or already locked this turn

    // Trust the seat, not the client-supplied player field.
    this.pending[seat] = { ...action, player: seat };
    // Tell the opponent someone locked — never what they locked.
    this.broadcast("locked", { seat }, { except: client });

    if (this.pending.P1 && this.pending.P2) this.resolve();
  }

  private resolve(): void {
    if (!this.game) return;
    this.game = resolveTurn(this.game, [this.pending.P1!, this.pending.P2!], this.rng);
    this.pending = { P1: null, P2: null };
    if (checkWinCondition(this.game)) this.phase = "ended";
    this.broadcastState();
  }

  private broadcastState(): void {
    if (!this.game) return;
    for (const client of this.clients) this.sendStateTo(client);
  }

  /** Send the authoritative, seat-redacted state to a single client. */
  private sendStateTo(client: Client): void {
    if (!this.game) return;
    const seat = this.seats.get(client.sessionId);
    if (!seat) return;
    const result = checkWinCondition(this.game);
    client.send("state", { state: redactFor(this.game, seat), result, seat });
  }

  /**
   * Rematch: both seats must vote while the match is over. When the second
   * vote lands we reseed and start a fresh match in the same room, keeping the
   * hero/territory choices and seat assignments.
   */
  private onRematch(client: Client): void {
    if (this.phase !== "ended" || this.seats.size < 2) return;
    const seat = this.seats.get(client.sessionId);
    if (!seat) return;

    this.rematchVotes.add(seat);
    this.broadcast("rematchVote", { seat });

    if (this.rematchVotes.size === 2) {
      // Fresh seed so the rematch isn't a continuation of the same RNG stream.
      this.rng = makeRng(Math.floor(Math.random() * 1_000_000_000));
      this.startMatch();
    }
  }

  // `consented` is true only for an intentional client.leave() (menu/quit). An
  // unexpected transport drop arrives with consented=false — we hold the seat
  // open for RECONNECT_WINDOW seconds rather than ending the match.
  override async onLeave(client: Client, consented: boolean): Promise<void> {
    const seat = this.seats.get(client.sessionId);
    if (!seat) return;

    // Intentional quit, or a drop outside an active match → end immediately.
    if (consented || this.phase !== "playing") {
      this.endByLeave(client, seat);
      return;
    }

    this.broadcast("opponentDropped", { seat }, { except: client });
    try {
      // Reconnection preserves sessionId, so `seats` stays valid. Push the
      // current authoritative state so the returning client rebuilds its board.
      const returned = await this.allowReconnection(client, RECONNECT_WINDOW);
      this.broadcast("opponentReturned", { seat }, { except: returned });
      this.sendStateTo(returned);
    } catch {
      this.endByLeave(client, seat);
    }
  }

  /** Award the match as abandoned and free the seat. */
  private endByLeave(client: Client, seat: PlayerId): void {
    this.seats.delete(client.sessionId);
    this.rematchVotes.delete(seat);
    if (this.phase !== "ended") {
      this.phase = "ended";
      this.broadcast("opponentLeft", { seat }, { except: client });
    }
  }
}
