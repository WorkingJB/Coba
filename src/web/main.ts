// Cardito browser client — human (P1) vs greedy bot (P2), entirely client-side.
// No backend: this is Build Sequence step 2, validating the loop with a human.
// It reuses the SAME pure engine the simulator uses (src/engine.ts) as authority.

import {
  initGame,
  resolveTurn,
  checkWinCondition,
} from "../engine.js";
import { chooseAction } from "../bot.js";
import { cardDef } from "../cards.js";
import { heroDef } from "../heroes.js";
import { territoryDef } from "../territory.js";
import { makeRng, type Rng } from "../rng.js";
import {
  type GameState,
  type PlannedAction,
  type ZoneId,
  ZONE_IDS,
} from "../types.js";

const HUMAN = "P1" as const;
const BOT = "P2" as const;
const REVEAL_MS = 1000; // beat between lock-in and resolution so the reveal is readable

interface Config {
  humanHeroId: string;
  botHeroId: string;
  territoryId: string;
}

let config: Config = {
  humanHeroId: "shade", // human pilots the Shade (the harder, tempo deck) by default
  botHeroId: "warden",
  territoryId: "neutral_field",
};

let game: GameState;
let rng: Rng;
let selectedCard: string | null = null; // card id the human has picked, awaiting a zone
let lastLogLen = 0; // where the current turn's log lines begin
// Both sides have locked in and we're mid-reveal (input frozen until resolution).
let pending: { human: PlannedAction; bot: PlannedAction } | null = null;

const app = document.getElementById("app")!;

function startGame(): void {
  rng = makeRng(Math.floor(Math.random() * 1_000_000_000));
  game = initGame({
    p1HeroId: config.humanHeroId,
    p2HeroId: config.botHeroId,
    territoryId: config.territoryId,
    rng,
  });
  selectedCard = null;
  lastLogLen = 0;
  pending = null;
  render();
}

/** Both players lock in. Hold a beat (the reveal), then resolve and advance. */
function takeTurn(humanAction: PlannedAction): void {
  if (checkWinCondition(game) || pending) return;
  pending = { human: humanAction, bot: chooseAction(game, BOT) };
  selectedCard = null;
  render();
  window.setTimeout(resolvePending, REVEAL_MS);
}

function resolvePending(): void {
  if (!pending) return;
  const { human, bot } = pending;
  lastLogLen = game.log.length;
  // resolveTurn matches actions by player id, so array order is irrelevant.
  game = resolveTurn(game, [human, bot], rng);
  pending = null;
  render();
}

function onPickCard(cardId: string): void {
  if (pending) return;
  selectedCard = selectedCard === cardId ? null : cardId;
  render();
}

function onPickZone(zone: ZoneId): void {
  if (pending || !selectedCard) return;
  takeTurn({ player: HUMAN, cardId: selectedCard, zone });
}

function onPass(): void {
  if (pending) return;
  takeTurn({ player: HUMAN, cardId: null, zone: null });
}

function describeAction(a: PlannedAction): string {
  if (a.cardId === null || a.zone === null) return "passed";
  return `${cardDef(a.cardId).name} → ${a.zone}`;
}

// ---------- rendering ----------

function el(tag: string, className?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function bar(value: number, max: number, glyph: string): string {
  const n = max <= 0 ? 0 : Math.round((value / max) * 12);
  return glyph.repeat(Math.min(12, n));
}

function render(): void {
  app.innerHTML = "";
  const result = checkWinCondition(game);
  const human = game.players[HUMAN];
  const bot = game.players[BOT];

  // Header.
  const header = el("div", "header");
  header.appendChild(el("h1", undefined, "CARDITO"));
  const sub = el("div", "sub");
  sub.innerHTML =
    `<span>Turn ${game.turn}</span>` +
    `<span>Battlefield: <b>${territoryDef(game.territoryId).name}</b> — ${territoryDef(game.territoryId).describe}</span>` +
    `<span>First to <b>${game.pointsToWin}</b> points</span>`;
  header.appendChild(sub);
  app.appendChild(header);

  // Scoreboard.
  const score = el("div", "score");
  score.appendChild(
    el("div", "score-you", `YOU (${heroDef(config.humanHeroId).name}) — ${human.points} pts`),
  );
  score.appendChild(
    el("div", "score-bot", `BOT (${heroDef(config.botHeroId).name}) — ${bot.points} pts`),
  );
  app.appendChild(score);

  // Zones.
  const zonesEl = el("div", "zones");
  for (const z of ZONE_IDS) {
    const youP = game.zones[z].presence[HUMAN];
    const botP = game.zones[z].presence[BOT];
    const ctrl = youP > botP ? "you" : botP > youP ? "bot" : "tie";
    const zone = el("div", `zone zone-${ctrl}` + (selectedCard ? " zone-targetable" : ""));
    zone.appendChild(el("div", "zone-name", z));
    const ctrlLabel =
      ctrl === "you" ? "◀ YOU CONTROL" : ctrl === "bot" ? "BOT CONTROLS ▶" : "— CONTESTED —";
    zone.appendChild(el("div", "zone-ctrl", ctrlLabel));
    const max = Math.max(youP, botP, 1);
    const you = el("div", "zone-side you");
    you.innerHTML = `<span class="num">${youP}</span> <span class="bargraph">${bar(youP, max, "▰")}</span>`;
    const bo = el("div", "zone-side bot");
    bo.innerHTML = `<span class="bargraph">${bar(botP, max, "▰")}</span> <span class="num">${botP}</span>`;
    zone.appendChild(you);
    zone.appendChild(bo);
    if (selectedCard && !result) {
      zone.addEventListener("click", () => onPickZone(z));
    }
    zonesEl.appendChild(zone);
  }
  app.appendChild(zonesEl);

  // Turn log (just this turn's lines).
  const logEl = el("div", "log");
  const relabel = (l: string) => l.replaceAll("P1", "YOU").replaceAll("P2", "BOT");
  const lines = game.log.slice(lastLogLen).filter((l) => !l.startsWith("—"));
  if (lines.length === 0) logEl.appendChild(el("div", "log-line muted", "Make your move…"));
  for (const line of lines) {
    const cls = line.includes("P1") ? "log-line you" : line.includes("P2") ? "log-line bot" : "log-line";
    logEl.appendChild(el("div", cls, relabel(line.trim())));
  }
  app.appendChild(logEl);

  // Reveal beat: both sides locked in, resolving shortly. Freeze input.
  if (pending) {
    const reveal = el("div", "resolving");
    reveal.appendChild(el("div", "resolving-title", "● LOCKED IN — RESOLVING…"));
    reveal.appendChild(el("div", "resolving-line you", `YOU: ${describeAction(pending.human)}`));
    reveal.appendChild(el("div", "resolving-line bot", "BOT: revealing…"));
    app.appendChild(reveal);
    app.appendChild(controls(false));
    return;
  }

  // Result banner or hand.
  if (result) {
    const banner = el("div", "banner");
    const won = result.winner === HUMAN;
    banner.classList.add(result.winner === "DRAW" ? "draw" : won ? "win" : "lose");
    banner.textContent =
      result.winner === "DRAW"
        ? `DRAW — ${human.points}–${bot.points} after ${result.turns} turns`
        : won
          ? `YOU WIN — ${human.points}–${bot.points} (by ${result.reason})`
          : `YOU LOSE — ${human.points}–${bot.points} (by ${result.reason})`;
    app.appendChild(banner);
    app.appendChild(controls(true));
    return;
  }

  // Hand.
  const handWrap = el("div", "hand-wrap");
  handWrap.appendChild(
    el(
      "div",
      "hand-prompt",
      selectedCard ? "▶ Now click a zone to play it" : `Energy: ${human.energy}/${human.energyCap} — pick a card`,
    ),
  );
  const hand = el("div", "hand");
  if (human.hand.length === 0) hand.appendChild(el("div", "muted", "(empty hand)"));
  for (let i = 0; i < human.hand.length; i++) {
    const id = human.hand[i]!;
    const def = cardDef(id);
    const affordable = def.cost <= human.energy;
    const card = el(
      "div",
      "card" +
        (def.kind === "spell" ? " card-spell" : " card-unit") +
        (selectedCard === id ? " card-selected" : "") +
        (affordable ? "" : " card-disabled"),
    );
    card.appendChild(el("div", "card-cost", String(def.cost)));
    card.appendChild(el("div", "card-name", def.name));
    card.appendChild(el("div", "card-kind", def.kind.toUpperCase()));
    card.appendChild(el("div", "card-text", def.text));
    if (affordable) card.addEventListener("click", () => onPickCard(id));
    hand.appendChild(card);
  }
  handWrap.appendChild(hand);
  app.appendChild(handWrap);
  app.appendChild(controls(false));
}

function controls(gameOver: boolean): HTMLElement {
  const row = el("div", "controls");
  if (gameOver) {
    const again = el("button", "btn btn-primary", "New match");
    again.addEventListener("click", startGame);
    row.appendChild(again);
  } else {
    const pass = el("button", "btn", "Pass turn");
    pass.addEventListener("click", onPass);
    row.appendChild(pass);
    const restart = el("button", "btn btn-ghost", "Restart");
    restart.addEventListener("click", startGame);
    row.appendChild(restart);
  }

  // Setup selectors (hero / territory) — restart on change.
  const setup = el("div", "setup");
  setup.appendChild(heroSelect());
  setup.appendChild(terrSelect());
  row.appendChild(setup);
  return row;
}

function heroSelect(): HTMLElement {
  const wrap = el("label", "selector");
  wrap.appendChild(el("span", undefined, "Your hero:"));
  const sel = document.createElement("select");
  for (const h of ["shade", "warden"]) {
    const o = document.createElement("option");
    o.value = h;
    o.textContent = `${heroDef(h).name} (${heroDef(h).archetype})`;
    if (h === config.humanHeroId) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener("change", () => {
    config = {
      ...config,
      humanHeroId: sel.value,
      botHeroId: sel.value === "shade" ? "warden" : "shade",
    };
    startGame();
  });
  wrap.appendChild(sel);
  return wrap;
}

function terrSelect(): HTMLElement {
  const wrap = el("label", "selector");
  wrap.appendChild(el("span", undefined, "Battlefield:"));
  const sel = document.createElement("select");
  for (const t of ["neutral_field", "volcanic_forge", "ancient_forest"]) {
    const o = document.createElement("option");
    o.value = t;
    o.textContent = territoryDef(t).name;
    if (t === config.territoryId) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener("change", () => {
    config = { ...config, territoryId: sel.value };
    startGame();
  });
  wrap.appendChild(sel);
  return wrap;
}

startGame();
