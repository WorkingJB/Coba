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

let room: Room | null = null;

function wire(r: Room, cb: NetCallbacks): void {
  room = r;
  r.onMessage("seat", (m: { seat: PlayerId; code: string }) => cb.onSeat?.(m.seat, m.code));
  r.onMessage("lobby", (m: { code: string; players: number }) => cb.onLobby?.(m));
  r.onMessage("state", (m: StateMsg) => cb.onState?.(m));
  r.onMessage("locked", (m: { seat: PlayerId }) => cb.onOpponentLocked?.(m.seat));
  r.onMessage("opponentLeft", () => cb.onOpponentLeft?.());
  r.onError((_code, message) => cb.onError?.(message ?? "connection error"));
  r.onLeave(() => { room = null; });
}

export async function createRoom(
  code: string,
  hero: string,
  territory: string,
  cb: NetCallbacks,
): Promise<void> {
  const client = new Client(endpoint());
  const r = await client.create("coba", { code, hero, territory });
  wire(r, cb);
}

export async function joinRoom(code: string, hero: string, cb: NetCallbacks): Promise<void> {
  const client = new Client(endpoint());
  const r = await client.join("coba", { code, hero });
  wire(r, cb);
}

export function sendLock(action: PlannedAction): void {
  room?.send("lock", action);
}

export function leave(): void {
  room?.leave();
  room = null;
}
