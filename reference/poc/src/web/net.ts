// Thin wrapper over colyseus.js for online play. The client never resolves a
// turn — it sends its locked action and applies whatever authoritative state
// the server sends back. See server/CobaRoom.ts for the matching protocol.

import { Client, type Room } from "colyseus.js";
import type { GameState, PlannedAction, PlayerId, MatchResult } from "../types.js";

export interface StateMsg {
  state: GameState;
  result: MatchResult | null;
  seat: PlayerId;
}

export interface NetCallbacks {
  onSeat?: (seat: PlayerId, code: string) => void;
  onLobby?: (info: { code: string; players: number }) => void;
  onState?: (msg: StateMsg) => void;
  onOpponentLocked?: (seat: PlayerId) => void;
  onOpponentLeft?: () => void;
  /** Opponent's connection dropped; their seat is held open server-side. */
  onOpponentDropped?: (seat: PlayerId) => void;
  /** A previously-dropped opponent reconnected. */
  onOpponentReturned?: (seat: PlayerId) => void;
  /** A seat voted to rematch (could be us or the opponent). */
  onRematchVote?: (seat: PlayerId) => void;
  /** Our own connection dropped; a reconnection attempt is underway. */
  onConnectionLost?: () => void;
  /** Our reconnection succeeded; the server will resend authoritative state. */
  onReconnected?: () => void;
  /** Reconnection gave up — the match is gone. */
  onConnectionFailed?: () => void;
  onError?: (message: string) => void;
}

/** Same-origin in production (server serves the client); :2567 in local dev. */
function endpoint(): string {
  const loc = window.location;
  if (loc.hostname === "localhost" || loc.hostname === "127.0.0.1") {
    if (loc.port !== "2567") return "ws://localhost:2567"; // Vite dev on :5173
  }
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${loc.host}`;
}

// Reconnection needs the originating Client, the live Room, its reconnection
// token, and the callbacks to re-wire onto a fresh Room. `leaving` guards the
// intentional-leave path so a user-initiated leave doesn't trigger a reconnect.
let client: Client | null = null;
let room: Room | null = null;
let reconnectionToken = "";
let callbacks: NetCallbacks | null = null;
let leaving = false;

const RECONNECT_TRIES = 6;
const RECONNECT_DELAY_MS = 2000; // 6 × 2s ≈ the server's 30s reconnect window

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function wire(r: Room, cb: NetCallbacks): void {
  room = r;
  callbacks = cb;
  reconnectionToken = r.reconnectionToken;
  r.onMessage("seat", (m: { seat: PlayerId; code: string }) => cb.onSeat?.(m.seat, m.code));
  r.onMessage("lobby", (m: { code: string; players: number }) => cb.onLobby?.(m));
  r.onMessage("state", (m: StateMsg) => cb.onState?.(m));
  r.onMessage("locked", (m: { seat: PlayerId }) => cb.onOpponentLocked?.(m.seat));
  r.onMessage("opponentLeft", () => cb.onOpponentLeft?.());
  r.onMessage("opponentDropped", (m: { seat: PlayerId }) => cb.onOpponentDropped?.(m.seat));
  r.onMessage("opponentReturned", (m: { seat: PlayerId }) => cb.onOpponentReturned?.(m.seat));
  r.onMessage("rematchVote", (m: { seat: PlayerId }) => cb.onRematchVote?.(m.seat));
  r.onError((_code, message) => cb.onError?.(message ?? "connection error"));
  // code 1000 = normal close. Anything else during a match is an unexpected
  // drop → try to reconnect into the seat the server is holding for us.
  r.onLeave((code: number) => {
    room = null;
    if (leaving || code === 1000) return;
    void attemptReconnect();
  });
}

async function attemptReconnect(): Promise<void> {
  if (!client) return;
  callbacks?.onConnectionLost?.();
  for (let i = 0; i < RECONNECT_TRIES; i++) {
    try {
      const r = await client.reconnect(reconnectionToken);
      wire(r, callbacks!);
      callbacks?.onReconnected?.();
      return;
    } catch {
      if (leaving) return;
      await delay(RECONNECT_DELAY_MS);
    }
  }
  callbacks?.onConnectionFailed?.();
}

export async function createRoom(
  code: string,
  hero: string,
  territory: string,
  cb: NetCallbacks,
): Promise<void> {
  leaving = false;
  client = new Client(endpoint());
  const r = await client.create("coba", { code, hero, territory });
  wire(r, cb);
}

export async function joinRoom(code: string, hero: string, cb: NetCallbacks): Promise<void> {
  leaving = false;
  client = new Client(endpoint());
  const r = await client.join("coba", { code, hero });
  wire(r, cb);
}

/** Public auto-queue: drop into the first open room or create one. No code. */
export async function quickMatch(hero: string, cb: NetCallbacks): Promise<void> {
  leaving = false;
  client = new Client(endpoint());
  const r = await client.joinOrCreate("coba_quick", { hero });
  wire(r, cb);
}

export function sendLock(action: PlannedAction): void {
  room?.send("lock", action);
}

export function sendRematch(): void {
  room?.send("rematch");
}

export function leave(): void {
  leaving = true;
  room?.leave();
  room = null;
  client = null;
}
