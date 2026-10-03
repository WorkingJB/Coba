// Coba browser client. Two modes share one match renderer:
//   · bot    — human (P1) vs greedy bot (P2), resolved locally (Build step 2).
//   · online — human vs human over Colyseus; the SERVER is authority and the
//              client only sends its locked action and renders returned state.
// Reuses the SAME pure engine the simulator uses (src/engine.ts).

import { initGame, resolveTurn, checkWinCondition } from "../engine.js";
import { chooseAction } from "../bot.js";
import { cardDef, CARDS } from "../cards.js";
import { heroDef, HERO_IDS } from "../heroes.js";
import { territoryDef, TERRITORIES } from "../territory.js";
import { makeRng, type Rng } from "../rng.js";
import {
  type GameState,
  type PlannedAction,
  type PlayerId,
  type ZoneId,
  ZONE_IDS,
  opponentOf,
} from "../types.js";
import * as net from "./net.js";
import * as auth from "./auth.js";
import type { AuthUser } from "./auth.js";

const REVEAL_MS = 1000; // beat between lock-in and resolution so the reveal is readable

type Mode = "bot" | "online";
type Screen = "menu" | "auth" | "select" | "join" | "lobby" | "match";

let mode: Mode = "bot";
let screen: Screen = "menu";

// Auth (Step 3 / A2). `session` is the signed-in user, or null. Online play is
// gated on it; bot play ignores it entirely. `afterAuth` is the online action to
// resume once login succeeds (so logging in doesn't lose the user's intent).
let session: AuthUser | null = null;
let authMode: "login" | "signup" = "login";
let authEmail = "";
let authPassword = "";
let authName = "";
let authError = "";
let authBusy = false;
let afterAuth: (() => void) | null = null;
let seat: PlayerId = "P1"; // which side the local player controls
let humanHeroId = "shade";
let territoryId = "neutral_field";

let roomCode = "";
let joinCodeInput = "";
let statusMsg = "";
let autoQueue = false; // online: hero-select is for public quick-match, not a coded room
let oppLocked = false; // online: opponent has locked this turn
let oppLeft = false; // online: opponent disconnected for good
let oppDropped = false; // online: opponent dropped, seat held for reconnect
let reconnecting = false; // online: our own connection dropped, retrying
let rematchVoted = false; // online: we voted to rematch
let oppRematchVoted = false; // online: opponent voted to rematch

let game: GameState | null = null;
let rng: Rng; // bot mode only
let selectedCard: string | null = null;
let armedAbility: ZoneId | null = null; // hero ability aimed for this turn
let abilityTargeting = false; // currently choosing a zone for the ability
let lastLogLen = 0;
let showOppDeck = false; // match: opponent deck library expanded (decks are public)
let pending: { human: PlannedAction; bot: PlannedAction | null } | null = null;
let prevPoints: Record<PlayerId, number> = { P1: 0, P2: 0 };
let lastGain: Record<PlayerId, number> = { P1: 0, P2: 0 };

const app = document.getElementById("app")!;

const foe = (): PlayerId => opponentOf(seat);
const oppLabel = (): string => (mode === "bot" ? "BOT" : "OPP");

function clearSelections(): void {
  selectedCard = null;
  armedAbility = null;
  abilityTargeting = false;
}

// ---------- flow: bot ----------

function startBotMatch(): void {
  mode = "bot";
  seat = "P1";
  rng = makeRng(Math.floor(Math.random() * 1_000_000_000));
  game = initGame({
    p1HeroId: humanHeroId,
    p2HeroId: HERO_IDS.find((h) => h !== humanHeroId) ?? humanHeroId,
    territoryId,
    rng,
  });
  resetMatchUi();
  screen = "match";
  render();
}

function resetMatchUi(): void {
  clearSelections();
  lastLogLen = 0;
  showOppDeck = false;
  pending = null;
  oppLocked = false;
  oppLeft = false;
  oppDropped = false;
  reconnecting = false;
  rematchVoted = false;
  oppRematchVoted = false;
  prevPoints = { P1: 0, P2: 0 };
  lastGain = { P1: 0, P2: 0 };
}

// ---------- flow: auth gating ----------

// Run `next` immediately if signed in; otherwise stash it and route to the auth
// screen — login/signup resumes it. Returns whether it ran (so callers can stop).
function requireSession(next: () => void): boolean {
  if (session) {
    next();
    return true;
  }
  afterAuth = next;
  authError = "";
  authMode = "login";
  screen = "auth";
  render();
  return false;
}

async function submitAuth(): Promise<void> {
  if (authBusy) return;
  const email = authEmail.trim();
  if (!email || !authPassword || (authMode === "signup" && !authName.trim())) {
    authError = "Fill in every field.";
    render();
    return;
  }
  authBusy = true;
  authError = "";
  render();
  try {
    session =
      authMode === "signup"
        ? await auth.signUp(email, authPassword, authName.trim())
        : await auth.signIn(email, authPassword);
    authBusy = false;
    authPassword = "";
    const next = afterAuth;
    afterAuth = null;
    if (next) next();
    else {
      screen = "menu";
      render();
    }
  } catch (e) {
    authBusy = false;
    authError = e instanceof Error ? e.message : "Something went wrong.";
    render();
  }
}

async function logOut(): Promise<void> {
  await auth.signOut().catch(() => {});
  session = null;
  if (mode === "online") net.leave();
  toMenu();
}

// ---------- flow: online ----------

function genCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous I/O/0/1
  let s = "";
  for (let i = 0; i < 4; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

const netCallbacks: net.NetCallbacks = {
  onSeat: (s, code) => {
    seat = s;
    roomCode = code;
    render();
  },
  onLobby: (info) => {
    statusMsg = info.players < 2 ? "Waiting for opponent…" : "Opponent joined — starting…";
    render();
  },
  onState: (msg) => applyServerState(msg),
  onOpponentLocked: () => {
    oppLocked = true;
    render();
  },
  onOpponentLeft: () => {
    oppLeft = true;
    oppDropped = false;
    statusMsg = "Opponent left — match ended.";
    render();
  },
  onOpponentDropped: () => {
    oppDropped = true;
    statusMsg = "Opponent dropped — waiting for them to reconnect…";
    render();
  },
  onOpponentReturned: () => {
    oppDropped = false;
    statusMsg = "Opponent reconnected.";
    render();
  },
  onRematchVote: (votedSeat) => {
    if (votedSeat === seat) rematchVoted = true;
    else oppRematchVoted = true;
    render();
  },
  onConnectionLost: () => {
    reconnecting = true;
    statusMsg = "Connection lost — reconnecting…";
    render();
  },
  onReconnected: () => {
    reconnecting = false;
    statusMsg = "Reconnected.";
    render();
  },
  onConnectionFailed: () => {
    reconnecting = false;
    oppLeft = true; // reuse the match-ended path
    statusMsg = "Lost connection to the match.";
    render();
  },
  onError: (m) => {
    statusMsg = m;
    render();
  },
};

async function hostRoom(): Promise<void> {
  mode = "online";
  roomCode = genCode();
  resetMatchUi();
  statusMsg = "Creating room…";
  screen = "lobby";
  render();
  try {
    await net.createRoom(roomCode, humanHeroId, territoryId, netCallbacks);
    statusMsg = "Waiting for opponent…";
    render();
  } catch {
    statusMsg = "Could not reach the server. Is it running?";
    screen = "menu";
    render();
  }
}

async function quickRoom(): Promise<void> {
  mode = "online";
  autoQueue = true;
  roomCode = "";
  resetMatchUi();
  statusMsg = "Finding an opponent…";
  screen = "lobby";
  render();
  try {
    await net.quickMatch(humanHeroId, netCallbacks);
  } catch {
    statusMsg = "Could not reach the server. Is it running?";
    screen = "menu";
    render();
  }
}

async function joinRoomFlow(): Promise<void> {
  const code = joinCodeInput.trim().toUpperCase();
  if (code.length !== 4) {
    statusMsg = "Enter the 4-character room code.";
    render();
    return;
  }
  mode = "online";
  roomCode = code;
  resetMatchUi();
  statusMsg = "Joining…";
  screen = "lobby";
  render();
  try {
    await net.joinRoom(code, humanHeroId, netCallbacks);
  } catch {
    statusMsg = `No room found for "${code}".`;
    screen = "join";
    render();
  }
}

function applyServerState(msg: net.StateMsg): void {
  prevPoints = game
    ? { P1: game.players.P1.points, P2: game.players.P2.points }
    : { P1: 0, P2: 0 };
  lastLogLen = game ? game.log.length : 0;
  const g = msg.state;
  lastGain = {
    P1: g.players.P1.points - prevPoints.P1,
    P2: g.players.P2.points - prevPoints.P2,
  };
  game = g;
  seat = msg.seat;
  pending = null;
  oppLocked = false;
  oppDropped = false;
  reconnecting = false;
  rematchVoted = false;
  oppRematchVoted = false;
  clearSelections();
  screen = "match";
  render();
}

function toMenu(): void {
  if (mode === "online") net.leave();
  mode = "bot";
  autoQueue = false;
  game = null;
  pending = null;
  statusMsg = "";
  oppLeft = false;
  oppDropped = false;
  reconnecting = false;
  clearSelections();
  screen = "menu";
  render();
}

// ---------- turn handling ----------

function takeTurn(action: PlannedAction): void {
  if (!game || checkWinCondition(game) || pending) return;
  if (mode === "bot") {
    pending = { human: action, bot: chooseAction(game, foe()) };
    clearSelections();
    render();
    window.setTimeout(resolvePending, REVEAL_MS);
  } else {
    pending = { human: action, bot: null };
    net.sendLock(action);
    clearSelections();
    render();
  }
}

function resolvePending(): void {
  if (!pending || !game || pending.bot === null) return; // bot mode only
  const { human, bot } = pending;
  lastLogLen = game.log.length;
  prevPoints = { P1: game.players.P1.points, P2: game.players.P2.points };
  game = resolveTurn(game, [human, bot], rng);
  lastGain = {
    P1: game.players.P1.points - prevPoints.P1,
    P2: game.players.P2.points - prevPoints.P2,
  };
  pending = null;
  render();
}

function commitCard(cardId: string, zone: ZoneId): void {
  takeTurn({ player: seat, cardId, zone, ability: armedAbility });
}

function onPickCard(cardId: string): void {
  if (pending) return;
  abilityTargeting = false; // picking a card exits ability-aim mode
  selectedCard = selectedCard === cardId ? null : cardId;
  render();
}

function onPickZone(zone: ZoneId): void {
  if (pending) return;
  if (abilityTargeting) {
    armedAbility = zone;
    abilityTargeting = false;
    render();
    return;
  }
  if (!selectedCard) return;
  commitCard(selectedCard, zone);
}

function onPass(): void {
  if (pending) return;
  takeTurn({ player: seat, cardId: null, zone: null, ability: armedAbility });
}

function onUseAbility(): void {
  if (pending || !game || game.players[seat].abilityReady > 0) return;
  abilityTargeting = true;
  selectedCard = null;
  render();
}

function onCancelAbility(): void {
  armedAbility = null;
  abilityTargeting = false;
  render();
}

function describeAction(a: PlannedAction): string {
  const parts: string[] = [];
  if (a.cardId !== null && a.zone !== null) {
    const c = cardDef(a.cardId);
    parts.push(c.allZones ? `${c.name} → all zones` : `${c.name} → ${a.zone}`);
  }
  if (a.ability && game) {
    const name = heroDef(game.players[a.player].heroId).ability.name;
    parts.push(`${name} → ${a.ability}`);
  }
  return parts.length ? parts.join(" + ") : "passed";
}

// ---------- small DOM helpers ----------

function el(tag: string, className?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Tug-of-war presence bar: green (you) vs red (opp), proportional, fits any width. */
function tugBar(youP: number, botP: number): HTMLElement {
  const total = Math.max(youP + botP, 1);
  const youPct = Math.round((youP / total) * 100);
  const wrap = el("div", "tug");
  const y = el("div", "tug-you");
  y.style.width = `${youP === 0 ? 0 : youPct}%`;
  const b = el("div", "tug-bot");
  b.style.width = `${botP === 0 ? 0 : 100 - youPct}%`;
  wrap.appendChild(y);
  wrap.appendChild(b);
  return wrap;
}

// ---- "what just happened" reveal: recover plays from the (shared, authoritative)
// engine log. Card/ability names are unique, so the name → id map is lossless, and
// this works identically in bot and online mode (same log format) with no protocol
// change. Opponent plays ARE public (they're in the log); only the hand is redacted.
const cardByName = new Map(Object.values(CARDS).map((c) => [c.name, c.id] as const));

interface TurnPlay {
  player: PlayerId;
  cardId: string | null; // the card played this line, if any
  abilityName: string | null; // the ability fired this line, if any
  target: string; // zone id or "ALL zones"
  impact: string; // the "(…)" detail straight from the log (the numeric effect)
  passed: boolean;
}

function parseTurnPlays(lines: string[]): TurnPlay[] {
  const out: TurnPlay[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    let m = line.match(/^(P1|P2) (?:plays|casts) (.+?) → (.+?) \((.+)\)\.?$/);
    if (m) {
      out.push({ player: m[1] as PlayerId, cardId: cardByName.get(m[2]!) ?? null, abilityName: null, target: m[3]!, impact: m[4]!, passed: false });
      continue;
    }
    m = line.match(/^(P1|P2) uses (.+?) → (.+?) \((.+)\)\.?$/);
    if (m) {
      out.push({ player: m[1] as PlayerId, cardId: null, abilityName: m[2]!, target: m[3]!, impact: m[4]!, passed: false });
      continue;
    }
    if (/^(P1|P2) passes\.$/.test(line) || /^(P1|P2) (?:tried to play|can't afford)/.test(line)) {
      out.push({ player: line.slice(0, 2) as PlayerId, cardId: null, abilityName: null, target: "", impact: "", passed: true });
    }
  }
  return out;
}

/** The "LAST TURN" panel: each side's actual played card + its numeric impact. */
function lastPlaysPanel(): HTMLElement {
  const plays = parseTurnPlays(game!.log.slice(lastLogLen));
  const panel = el("div", "lastplay");
  panel.appendChild(el("div", "lastplay-head", "LAST TURN"));
  if (plays.length === 0) {
    panel.appendChild(el("div", "muted", game!.turn === 1 ? "Match start — make your move." : "Your move — pick a card."));
    return panel;
  }
  const cols = el("div", "lastplay-cols");
  for (const who of [seat, foe()]) {
    const mine = who === seat;
    const col = el("div", "lastplay-col " + (mine ? "you" : "opp"));
    col.appendChild(el("div", "lastplay-who", mine ? "YOU" : `${oppLabel()} · ${heroDef(game!.players[who].heroId).name}`));
    const acts = plays.filter((p) => p.player === who && (p.cardId || p.abilityName));
    if (acts.length === 0) {
      col.appendChild(el("div", "lastplay-pass muted", "— passed —"));
    } else {
      for (const p of acts) {
        if (p.cardId) col.appendChild(cardEl(p.cardId, { mini: true }));
        else col.appendChild(el("div", "lastplay-ability", `✦ ${p.abilityName}`));
        col.appendChild(el("div", "lastplay-impact", `→ ${p.target} · ${p.impact}`));
      }
    }
    cols.appendChild(col);
  }
  panel.appendChild(cols);
  return panel;
}

function deckGroups(heroId: string): { id: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const id of heroDef(heroId).deck) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => cardDef(a.id).cost - cardDef(b.id).cost);
}

function cardEl(id: string, opts: { count?: number; mini?: boolean } = {}): HTMLElement {
  const def = cardDef(id);
  const card = el("div", "card" + ` card-${def.kind}` + (opts.mini ? " card-mini" : ""));
  card.appendChild(el("div", "card-cost", String(def.cost)));
  if (opts.count && opts.count > 1) card.appendChild(el("div", "card-count", `×${opts.count}`));
  card.appendChild(el("div", "card-name", def.name));
  const kind = def.allZones ? `${def.kind.toUpperCase()} · ALL ZONES` : def.kind.toUpperCase();
  card.appendChild(el("div", "card-kind", kind));
  card.appendChild(el("div", "card-text", def.text));
  return card;
}

/** Hero panels grid, shared by the bot/host select and the join screen. */
function heroChoiceEl(): HTMLElement {
  const heroes = el("div", "hero-choice");
  for (const id of HERO_IDS) {
    const h = heroDef(id);
    const panel = el("div", "hero-panel" + (id === humanHeroId ? " hero-selected" : ""));
    const head = el("div", "hero-head");
    head.appendChild(el("div", "hero-name", h.name));
    head.appendChild(el("div", "hero-arch", h.archetype));
    panel.appendChild(head);

    panel.appendChild(el("div", "lib-label", `DECK LIBRARY (${h.deck.length} cards)`));
    const lib = el("div", "lib");
    for (const g of deckGroups(id)) lib.appendChild(cardEl(g.id, { count: g.count, mini: true }));
    panel.appendChild(lib);

    panel.addEventListener("click", () => {
      humanHeroId = id;
      render();
    });
    heroes.appendChild(panel);
  }
  return heroes;
}

// ---------- screen: menu ----------

function renderMenu(): void {
  app.innerHTML = "";
  const header = el("div", "header");
  header.appendChild(el("h1", undefined, "COBA"));
  header.appendChild(el("div", "tagline", "Tactical card combat for three zones."));
  app.appendChild(header);

  const menu = el("div", "menu");
  const bot = el("button", "btn btn-primary btn-big", "Play vs Bot");
  bot.addEventListener("click", () => {
    mode = "bot";
    screen = "select";
    render();
  });
  const quick = el("button", "btn btn-big", "Quick Match ▸");
  quick.addEventListener("click", () =>
    requireSession(() => {
      mode = "online";
      autoQueue = true;
      screen = "select";
      render();
    }),
  );
  const create = el("button", "btn btn-big", "Create Room ▸");
  create.addEventListener("click", () =>
    requireSession(() => {
      mode = "online";
      autoQueue = false;
      screen = "select";
      render();
    }),
  );
  const join = el("button", "btn btn-big", "Join Room ▸");
  join.addEventListener("click", () =>
    requireSession(() => {
      mode = "online";
      statusMsg = "";
      screen = "join";
      render();
    }),
  );
  menu.appendChild(bot);
  menu.appendChild(quick);
  menu.appendChild(create);
  menu.appendChild(join);
  app.appendChild(menu);

  // Account bar: who's signed in (+ logout), or a note that online needs login.
  const account = el("div", "account");
  if (session) {
    account.appendChild(el("span", "account-who", `● Signed in as ${session.name}`));
    const out = el("button", "btn btn-ghost btn-sm", "Log out");
    out.addEventListener("click", logOut);
    account.appendChild(out);
  } else {
    account.appendChild(el("span", "account-who muted", "Online play needs an account."));
    const login = el("button", "btn btn-ghost btn-sm", "Log in / Sign up");
    login.addEventListener("click", () =>
      requireSession(() => {
        screen = "menu";
        render();
      }),
    );
    account.appendChild(login);
  }
  app.appendChild(account);

  if (statusMsg) app.appendChild(el("div", "status", statusMsg));
}

// ---------- screen: auth (login / signup) ----------

function renderAuth(): void {
  app.innerHTML = "";
  const signup = authMode === "signup";

  const header = el("div", "header");
  header.appendChild(el("h1", undefined, "COBA"));
  header.appendChild(
    el("div", "tagline", signup ? "Create an account to play online." : "Log in to play online."),
  );
  app.appendChild(header);

  const form = el("div", "auth-form");

  // name (signup only), email, password — each an .auth-field row.
  function field(label: string, type: string, value: string, onInput: (v: string) => void, autocomplete: string): HTMLInputElement {
    const wrap = el("label", "auth-field");
    wrap.appendChild(el("span", "auth-label", label));
    const input = document.createElement("input");
    input.className = "auth-input";
    input.type = type;
    input.value = value;
    input.setAttribute("autocomplete", autocomplete); // .autocomplete is the AutoFill union, not string
    input.addEventListener("input", () => onInput(input.value));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void submitAuth();
    });
    wrap.appendChild(input);
    form.appendChild(wrap);
    return input;
  }

  if (signup) field("Display name", "text", authName, (v) => (authName = v), "nickname");
  field("Email", "email", authEmail, (v) => (authEmail = v), "email");
  field("Password", "password", authPassword, (v) => (authPassword = v), signup ? "new-password" : "current-password");

  app.appendChild(form);

  if (authError) app.appendChild(el("div", "auth-error", authError));

  const footer = el("div", "select-footer");
  const submit = el("button", "btn btn-primary btn-big", authBusy ? "…" : signup ? "Create account ▸" : "Log in ▸");
  if (authBusy) (submit as HTMLButtonElement).disabled = true;
  submit.addEventListener("click", () => void submitAuth());
  footer.appendChild(submit);

  const toggle = el("button", "btn btn-ghost", signup ? "Have an account? Log in" : "Need an account? Sign up");
  toggle.addEventListener("click", () => {
    authMode = signup ? "login" : "signup";
    authError = "";
    render();
  });
  footer.appendChild(toggle);

  const back = el("button", "btn btn-ghost", "↩ Back");
  back.addEventListener("click", () => {
    afterAuth = null;
    toMenu();
  });
  footer.appendChild(back);
  app.appendChild(footer);
}

// ---------- screen: hero select (bot match or online host) ----------

function renderSelect(): void {
  app.innerHTML = "";
  const host = mode === "online" && !autoQueue; // creating a coded room
  const quick = mode === "online" && autoQueue; // public auto-queue
  const tagline = quick
    ? "Quick match — pick your hero, then we'll find an opponent."
    : host
      ? "Create a room — pick your hero and battlefield."
      : "Choose your hero.";

  const header = el("div", "header");
  header.appendChild(el("h1", undefined, "COBA"));
  header.appendChild(el("div", "tagline", tagline));
  app.appendChild(header);

  const rules = el("div", "rules");
  rules.appendChild(el("div", "rules-title", "HOW A MATCH WORKS"));
  const ul = el("ul", "rules-list");
  for (const line of [
    `Each turn you and your ${host ? "opponent" : "opponent"} secretly pick ONE card + a zone, then reveal at the same time.`,
    "Hold a zone at end of turn (more presence than your opponent) to score 1 point — all three zones score every turn.",
    "Energy starts at 1 and rises +1 each turn (max 8). Bigger cards cost more, so your options grow over time.",
    "First to 12 points wins. The battlefield bends the rules (not raw power).",
  ]) ul.appendChild(el("li", undefined, line));
  rules.appendChild(ul);
  app.appendChild(rules);

  app.appendChild(el("div", "section-label", "CHOOSE YOUR HERO"));
  app.appendChild(heroChoiceEl());

  const footer = el("div", "select-footer");

  // Quick matches use a server-assigned battlefield, so only the room creator
  // (bot match or coded host) gets to pick one.
  if (!quick) {
    const terr = el("label", "selector");
    terr.appendChild(el("span", undefined, "Battlefield:"));
    const sel = document.createElement("select");
    for (const t of Object.keys(TERRITORIES)) {
      const o = document.createElement("option");
      o.value = t;
      o.textContent = territoryDef(t).name;
      if (t === territoryId) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener("change", () => {
      territoryId = sel.value;
      render();
    });
    terr.appendChild(sel);
    footer.appendChild(terr);
    footer.appendChild(el("div", "terr-desc", territoryDef(territoryId).describe));
  }

  const heroName = heroDef(humanHeroId).name;
  const startLabel = quick
    ? `Find match as ${heroName} ▸`
    : host
      ? `Create room as ${heroName} ▸`
      : `Start as ${heroName} ▶`;
  const start = el("button", "btn btn-primary btn-big", startLabel);
  start.addEventListener("click", quick ? quickRoom : host ? hostRoom : startBotMatch);
  footer.appendChild(start);

  const back = el("button", "btn btn-ghost", "↩ Back");
  back.addEventListener("click", toMenu);
  footer.appendChild(back);
  app.appendChild(footer);
}

// ---------- screen: join (enter code + hero) ----------

function renderJoin(): void {
  app.innerHTML = "";
  const header = el("div", "header");
  header.appendChild(el("h1", undefined, "COBA"));
  header.appendChild(el("div", "tagline", "Join a room — enter the code your opponent shared."));
  app.appendChild(header);

  const codeWrap = el("div", "join-wrap");
  codeWrap.appendChild(el("div", "section-label", "ROOM CODE"));
  const input = document.createElement("input");
  input.className = "code-input";
  input.maxLength = 4;
  input.placeholder = "ABCD";
  input.value = joinCodeInput;
  input.autocapitalize = "characters";
  input.addEventListener("input", () => {
    joinCodeInput = input.value.toUpperCase();
    input.value = joinCodeInput;
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinRoomFlow();
  });
  codeWrap.appendChild(input);
  app.appendChild(codeWrap);

  app.appendChild(el("div", "section-label", "CHOOSE YOUR HERO"));
  app.appendChild(heroChoiceEl());

  if (statusMsg) app.appendChild(el("div", "status", statusMsg));

  const footer = el("div", "select-footer");
  const join = el("button", "btn btn-primary btn-big", "Join match ▸");
  join.addEventListener("click", joinRoomFlow);
  footer.appendChild(join);
  const back = el("button", "btn btn-ghost", "↩ Back");
  back.addEventListener("click", toMenu);
  footer.appendChild(back);
  app.appendChild(footer);
}

// ---------- screen: lobby (waiting) ----------

function renderLobby(): void {
  app.innerHTML = "";
  const header = el("div", "header");
  header.appendChild(el("h1", undefined, "COBA"));
  app.appendChild(header);

  const lobby = el("div", "lobby");
  if (autoQueue) {
    lobby.appendChild(el("div", "lobby-label", "QUICK MATCH"));
    lobby.appendChild(el("div", "lobby-code", "···"));
  } else {
    lobby.appendChild(el("div", "lobby-label", "ROOM CODE — share this with your opponent"));
    lobby.appendChild(el("div", "lobby-code", roomCode || "····"));
  }
  lobby.appendChild(el("div", "status", statusMsg || "Connecting…"));
  const spinner = el("div", "lobby-dots", "● ● ●");
  lobby.appendChild(spinner);
  app.appendChild(lobby);

  const cancel = el("button", "btn btn-ghost", "Cancel");
  cancel.addEventListener("click", toMenu);
  app.appendChild(cancel);
}

// ---------- screen: match ----------

function renderMatch(): void {
  if (!game) return;
  app.innerHTML = "";
  const me = seat;
  const opp = foe();
  const result = checkWinCondition(game);
  const human = game.players[me];
  const bot = game.players[opp];
  const localHeroId = human.heroId;

  // Header with explicit energy readout.
  const header = el("div", "header");
  const top = el("div", "match-top");
  top.appendChild(el("span", "pill", `Turn ${game.turn}`));
  top.appendChild(el("span", "pill pill-energy", `⚡ Energy ${human.energy}/${human.energyCap}  (+1 each turn, max 8)`));
  top.appendChild(el("span", "pill", `First to ${game.pointsToWin}`));
  if (mode === "online") top.appendChild(el("span", "pill", autoQueue ? "Quick Match" : `Room ${roomCode}`));
  header.appendChild(top);
  header.appendChild(
    el("div", "battlefield", `Battlefield: ${territoryDef(game.territoryId).name} — ${territoryDef(game.territoryId).describe}`),
  );
  app.appendChild(header);

  // Scoreboard.
  const zonesHeld = (p: PlayerId) =>
    ZONE_IDS.filter((z) => {
      const a = game!.zones[z].presence[me];
      const b = game!.zones[z].presence[opp];
      return p === me ? a > b : b > a;
    }).length;
  const score = el("div", "score");
  const youScore = el("div", "score-you");
  youScore.innerHTML =
    `<div class="score-pts">YOU — <b>${human.points}</b> pts` +
    (lastGain[me] > 0 ? ` <span class="gain">+${lastGain[me]}</span>` : "") +
    `</div><div class="score-zones">holding ${zonesHeld(me)}/3 zones</div>`;
  const botScore = el("div", "score-bot");
  botScore.innerHTML =
    `<div class="score-pts">${oppLabel()} — <b>${bot.points}</b> pts` +
    (lastGain[opp] > 0 ? ` <span class="gain">+${lastGain[opp]}</span>` : "") +
    `</div><div class="score-zones">holding ${zonesHeld(opp)}/3 zones</div>`;
  score.appendChild(youScore);
  score.appendChild(botScore);
  app.appendChild(score);

  // Opponent deck (public info — same library shown at hero-select). Lets a player
  // learn what they're up against, per playtest feedback.
  const oppHero = heroDef(bot.heroId);
  const deckToggle = el("button", "btn btn-ghost btn-sm oppdeck-toggle",
    `${showOppDeck ? "▾" : "▸"} ${oppLabel()}'s deck — ${oppHero.name} (${oppHero.archetype})`);
  deckToggle.addEventListener("click", () => { showOppDeck = !showOppDeck; render(); });
  app.appendChild(deckToggle);
  if (showOppDeck) {
    const panel = el("div", "oppdeck");
    panel.appendChild(el("div", "lib-label", `DECK LIBRARY (${oppHero.deck.length} cards)`));
    const lib = el("div", "lib");
    for (const g of deckGroups(bot.heroId)) lib.appendChild(cardEl(g.id, { count: g.count, mini: true }));
    panel.appendChild(lib);
    app.appendChild(panel);
  }

  // Zones.
  const zonesEl = el("div", "zones");
  for (const z of ZONE_IDS) {
    const youP = game.zones[z].presence[me];
    const botP = game.zones[z].presence[opp];
    const ctrl = youP > botP ? "you" : botP > youP ? "bot" : "tie";
    const targetable = (selectedCard || abilityTargeting) && !pending && !result;
    const zone = el("div", `zone zone-${ctrl}` + (targetable ? " zone-targetable" : ""));
    const nameRow = el("div", "zone-name-row");
    nameRow.appendChild(el("span", "zone-name", z));
    if (ctrl !== "tie") nameRow.appendChild(el("span", `zone-pip pip-${ctrl}`, "★ +1"));
    zone.appendChild(nameRow);
    const ctrlLabel = ctrl === "you" ? "YOU control" : ctrl === "bot" ? `${oppLabel()} controls` : "contested";
    zone.appendChild(el("div", "zone-ctrl", ctrlLabel));
    zone.appendChild(tugBar(youP, botP));
    const nums = el("div", "zone-nums");
    nums.innerHTML = `<span class="num you">${youP}</span><span class="zone-vs">vs</span><span class="num bot">${botP}</span>`;
    zone.appendChild(nums);
    if (targetable) zone.addEventListener("click", () => onPickZone(z));
    zonesEl.appendChild(zone);
  }
  app.appendChild(zonesEl);

  // "Last turn" reveal — shows each side's actual played card + numeric impact,
  // so a player can see what the opponent did and understand its effect.
  app.appendChild(lastPlaysPanel());

  // Our own connection dropped — board is stale, block play until we're back.
  if (reconnecting) {
    const banner = el("div", "banner draw");
    banner.textContent = statusMsg || "Connection lost — reconnecting…";
    app.appendChild(banner);
    app.appendChild(matchControls(false));
    return;
  }

  // Opponent dropped: seat is held server-side. Show a notice but keep the
  // board visible (the server resolves the turn once they're back).
  if (oppDropped && !checkWinCondition(game)) {
    const notice = el("div", "banner draw");
    notice.textContent = statusMsg || "Opponent dropped — holding their seat…";
    app.appendChild(notice);
  }

  // Opponent-left banner takes precedence.
  if (oppLeft) {
    const banner = el("div", "banner lose");
    banner.textContent = statusMsg || "Opponent left — match ended.";
    app.appendChild(banner);
    app.appendChild(matchControls(result !== null));
    return;
  }

  // Reveal / waiting beat.
  if (pending) {
    const reveal = el("div", "resolving");
    if (mode === "bot") {
      reveal.appendChild(el("div", "resolving-title", "● LOCKED IN — RESOLVING…"));
      reveal.appendChild(el("div", "resolving-line you", `YOU: ${describeAction(pending.human)}`));
      reveal.appendChild(el("div", "resolving-line bot", "BOT: revealing…"));
    } else {
      reveal.appendChild(el("div", "resolving-title", "● LOCKED IN — WAITING FOR OPPONENT…"));
      reveal.appendChild(el("div", "resolving-line you", `YOU: ${describeAction(pending.human)}`));
      reveal.appendChild(el("div", "resolving-line bot", oppLocked ? "OPP: locked in ✓" : "OPP: choosing…"));
    }
    app.appendChild(reveal);
    app.appendChild(matchControls(false));
    return;
  }

  // Result.
  if (result) {
    const banner = el("div", "banner");
    const won = result.winner === me;
    banner.classList.add(result.winner === "DRAW" ? "draw" : won ? "win" : "lose");
    banner.textContent =
      result.winner === "DRAW"
        ? `DRAW — ${human.points}–${bot.points} after ${result.turns} turns`
        : won
          ? `YOU WIN — ${human.points}–${bot.points} (by ${result.reason})`
          : `YOU LOSE — ${human.points}–${bot.points} (by ${result.reason})`;
    app.appendChild(banner);
    app.appendChild(matchControls(true));
    return;
  }

  // Hero ability.
  app.appendChild(abilityPanel(localHeroId));

  // Hand.
  const selCard = selectedCard ? cardDef(selectedCard) : null;
  const handWrap = el("div", "hand-wrap");
  const abilityName = heroDef(localHeroId).ability.name;
  const prompt = abilityTargeting
    ? `▶ Click a zone to aim ${abilityName}`
    : selCard
      ? selCard.allZones
        ? "▶ Hits ALL zones — press Cast Everywhere (or click any zone)"
        : "▶ Now click a zone to play it"
      : "Pick a card to play" + (armedAbility ? ` (${abilityName} aimed → ${armedAbility})` : "");
  handWrap.appendChild(el("div", "hand-prompt", prompt));

  if (selCard?.allZones) {
    const cast = el("button", "btn btn-primary", "Cast Everywhere");
    cast.addEventListener("click", () => commitCard(selCard.id, ZONE_IDS[0]!));
    handWrap.appendChild(cast);
  }

  const hand = el("div", "hand");
  if (human.hand.length === 0) hand.appendChild(el("div", "muted", "(empty hand)"));
  for (const id of human.hand) {
    const def = cardDef(id);
    const affordable = def.cost <= human.energy;
    const card = cardEl(id);
    if (selectedCard === id) card.classList.add("card-selected");
    if (!affordable) card.classList.add("card-disabled");
    if (affordable) card.addEventListener("click", () => onPickCard(id));
    hand.appendChild(card);
  }
  handWrap.appendChild(hand);
  app.appendChild(handWrap);
  app.appendChild(matchControls(false));
}

function abilityPanel(localHeroId: string): HTMLElement {
  const p = game!.players[seat];
  const ab = heroDef(localHeroId).ability;
  const ready = p.abilityReady === 0;
  const wrap = el("div", "ability" + (ready && !armedAbility ? " ability-ready" : ""));

  const info = el("div", "ability-info");
  info.appendChild(el("div", "ability-name", `✦ ${ab.name}`));
  info.appendChild(el("div", "ability-text", ab.text));
  wrap.appendChild(info);

  const right = el("div", "ability-action");
  if (armedAbility) {
    right.appendChild(el("span", "ability-armed", `aimed → ${armedAbility}`));
    const cancel = el("button", "btn btn-ghost btn-sm", "cancel");
    cancel.addEventListener("click", onCancelAbility);
    right.appendChild(cancel);
  } else if (abilityTargeting) {
    right.appendChild(el("span", "ability-armed", "choose a zone…"));
    const cancel = el("button", "btn btn-ghost btn-sm", "cancel");
    cancel.addEventListener("click", onCancelAbility);
    right.appendChild(cancel);
  } else if (ready) {
    const use = el("button", "btn btn-sm btn-ability", "Use Ability");
    use.addEventListener("click", onUseAbility);
    right.appendChild(use);
  } else {
    right.appendChild(el("span", "ability-cd", `cooldown: ${p.abilityReady} turn${p.abilityReady > 1 ? "s" : ""}`));
  }
  wrap.appendChild(right);
  return wrap;
}

function matchControls(ended: boolean): HTMLElement {
  const row = el("div", "controls");
  if (ended) {
    if (mode === "bot") {
      const again = el("button", "btn btn-primary", "Play again");
      again.addEventListener("click", startBotMatch);
      row.appendChild(again);
    } else if (!oppLeft) {
      // Online: rematch needs both players. Reflect vote state on the button.
      const label = rematchVoted
        ? oppRematchVoted ? "Starting rematch…" : "Waiting for opponent…"
        : oppRematchVoted ? "Rematch (opponent ready) ▸" : "Rematch ▸";
      const again = el("button", "btn btn-primary", label);
      if (rematchVoted) (again as HTMLButtonElement).disabled = true;
      again.addEventListener("click", () => {
        rematchVoted = true;
        net.sendRematch();
        render();
      });
      row.appendChild(again);
    }
    const menu = el("button", "btn btn-ghost", "↩ Menu");
    menu.addEventListener("click", toMenu);
    row.appendChild(menu);
    return row;
  }
  const pass = el("button", "btn", "Pass turn");
  pass.addEventListener("click", onPass);
  if (pending) (pass as HTMLButtonElement).disabled = true;
  row.appendChild(pass);
  const leave = el("button", "btn btn-ghost", mode === "bot" ? "↩ Hero select" : "↩ Leave match");
  leave.addEventListener("click", mode === "bot" ? () => { screen = "select"; render(); } : toMenu);
  row.appendChild(leave);
  return row;
}

// ---------- dispatch ----------

function render(): void {
  switch (screen) {
    case "menu":
      renderMenu();
      break;
    case "auth":
      renderAuth();
      break;
    case "select":
      renderSelect();
      break;
    case "join":
      renderJoin();
      break;
    case "lobby":
      renderLobby();
      break;
    case "match":
      renderMatch();
      break;
  }
}

render();

// Restore an existing session on load (cookie may already be valid), then
// re-render so the menu reflects the signed-in state without a flash of "logged
// out". Failure just leaves us anonymous — bot play still works offline.
void auth.getSession().then((u) => {
  if (u) {
    session = u;
    if (screen === "menu") render();
  }
});
