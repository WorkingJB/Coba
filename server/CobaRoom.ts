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
    const result = checkWinCondition(this.game);
    for (const client of this.clients) {
      const seat = this.seats.get(client.sessionId);
      if (!seat) continue;
      client.send("state", { state: redactFor(this.game, seat), result, seat });
    }
  }

  override onLeave(client: Client): void {
    const seat = this.seats.get(client.sessionId);
    this.seats.delete(client.sessionId);
    if (this.phase !== "ended") {
      this.phase = "ended";
      this.broadcast("opponentLeft", { seat }, { except: client });
    }
  }
}
