// Cardito browser client — human (P1) vs greedy bot (P2), entirely client-side.
// Two screens: a pre-match hero-select (with deck library) and the match itself.
// Reuses the SAME pure engine the simulator uses (src/engine.ts) as authority.

import { initGame, resolveTurn, checkWinCondition } from "../engine.js";
import { chooseAction } from "../bot.js";
import { cardDef } from "../cards.js";
import { heroDef, HERO_IDS } from "../heroes.js";
import { territoryDef, TERRITORIES } from "../territory.js";
import { makeRng, type Rng } from "../rng.js";
import {
  type GameState,
  type PlannedAction,
  type PlayerId,
  type ZoneId,
  ZONE_IDS,
} from "../types.js";

const HUMAN = "P1" as const;
const BOT = "P2" as const;
const REVEAL_MS = 1000; // beat between lock-in and resolution so the reveal is readable

type Screen = "select" | "match";

let screen: Screen = "select";
let humanHeroId = "shade";
let territoryId = "neutral_field";

let game: GameState;
let rng: Rng;
let selectedCard: string | null = null;
let armedAbility: ZoneId | null = null; // hero ability aimed for this turn
let abilityTargeting = false; // currently choosing a zone for the ability
let lastLogLen = 0;
let pending: { human: PlannedAction; bot: PlannedAction } | null = null;
let prevPoints: Record<PlayerId, number> = { P1: 0, P2: 0 };
let lastGain: Record<PlayerId, number> = { P1: 0, P2: 0 };

const app = document.getElementById("app")!;

// ---------- flow ----------

function startMatch(): void {
  rng = makeRng(Math.floor(Math.random() * 1_000_000_000));
  game = initGame({
    p1HeroId: humanHeroId,
    p2HeroId: HERO_IDS.find((h) => h !== humanHeroId) ?? humanHeroId,
    territoryId,
    rng,
  });
  selectedCard = null;
  armedAbility = null;
  abilityTargeting = false;
  lastLogLen = 0;
  pending = null;
  prevPoints = { P1: 0, P2: 0 };
  lastGain = { P1: 0, P2: 0 };
  screen = "match";
  render();
}

function takeTurn(humanAction: PlannedAction): void {
  if (checkWinCondition(game) || pending) return;
  pending = { human: humanAction, bot: chooseAction(game, BOT) };
  selectedCard = null;
  armedAbility = null;
  abilityTargeting = false;
  render();
  window.setTimeout(resolvePending, REVEAL_MS);
}

function resolvePending(): void {
  if (!pending) return;
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
  takeTurn({ player: HUMAN, cardId, zone, ability: armedAbility });
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
  takeTurn({ player: HUMAN, cardId: null, zone: null, ability: armedAbility });
}

function onUseAbility(): void {
  if (pending || game.players[HUMAN].abilityReady > 0) return;
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
  if (a.ability) {
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

function bar(value: number, max: number, glyph: string): string {
  const n = max <= 0 ? 0 : Math.round((value / max) * 12);
  return glyph.repeat(Math.min(12, n));
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
  const card = el("div", "card" + (def.kind === "spell" ? " card-spell" : " card-unit") + (opts.mini ? " card-mini" : ""));
  card.appendChild(el("div", "card-cost", String(def.cost)));
  if (opts.count && opts.count > 1) card.appendChild(el("div", "card-count", `×${opts.count}`));
  card.appendChild(el("div", "card-name", def.name));
  const kind = def.allZones ? `${def.kind.toUpperCase()} · ALL ZONES` : def.kind.toUpperCase();
  card.appendChild(el("div", "card-kind", kind));
  card.appendChild(el("div", "card-text", def.text));
  return card;
}

// ---------- screen: hero select ----------

function renderSelect(): void {
  app.innerHTML = "";

  const header = el("div", "header");
  header.appendChild(el("h1", undefined, "CARDITO"));
  header.appendChild(el("div", "tagline", "Tactical card combat for three zones. Choose your hero."));
  app.appendChild(header);

  // How it works.
  const rules = el("div", "rules");
  rules.appendChild(el("div", "rules-title", "HOW A MATCH WORKS"));
  const ul = el("ul", "rules-list");
  for (const line of [
    "Each turn you and the bot secretly pick ONE card + a zone, then reveal at the same time.",
    "Hold a zone at end of turn (more presence than the bot) to score 1 point — all three zones score every turn.",
    "Energy starts at 1 and rises +1 each turn (max 8). Bigger cards cost more, so your options grow over time.",
    "First to 12 points wins. The battlefield bends the rules (not raw power).",
  ]) ul.appendChild(el("li", undefined, line));
  rules.appendChild(ul);
  app.appendChild(rules);

  // Hero choice with deck libraries.
  app.appendChild(el("div", "section-label", "CHOOSE YOUR HERO"));
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
  app.appendChild(heroes);

  // Battlefield + start.
  const footer = el("div", "select-footer");
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

  const start = el("button", "btn btn-primary btn-big", `Start as ${heroDef(humanHeroId).name} ▶`);
  start.addEventListener("click", startMatch);
  footer.appendChild(start);
  app.appendChild(footer);
}

// ---------- screen: match ----------

function renderMatch(): void {
  app.innerHTML = "";
  const result = checkWinCondition(game);
  const human = game.players[HUMAN];
  const bot = game.players[BOT];

  // Header with explicit energy readout.
  const header = el("div", "header");
  const top = el("div", "match-top");
  top.appendChild(el("span", "pill", `Turn ${game.turn}`));
  top.appendChild(el("span", "pill pill-energy", `⚡ Energy ${human.energy}/${human.energyCap}  (+1 each turn, max 8)`));
  top.appendChild(el("span", "pill", `First to ${game.pointsToWin}`));
  header.appendChild(top);
  header.appendChild(
    el("div", "battlefield", `Battlefield: ${territoryDef(game.territoryId).name} — ${territoryDef(game.territoryId).describe}`),
  );
  app.appendChild(header);

  // Scoreboard — points live here (separated from the action log), with the
  // points gained on the last resolved turn and a zones-held tally.
  const zonesHeld = (p: PlayerId) =>
    ZONE_IDS.filter((z) => {
      const a = game.zones[z].presence[HUMAN];
      const b = game.zones[z].presence[BOT];
      return p === HUMAN ? a > b : b > a;
    }).length;
  const score = el("div", "score");
  const youScore = el("div", "score-you");
  youScore.innerHTML =
    `<div class="score-pts">YOU — <b>${human.points}</b> pts` +
    (lastGain.P1 > 0 ? ` <span class="gain">+${lastGain.P1}</span>` : "") +
    `</div><div class="score-zones">holding ${zonesHeld(HUMAN)}/3 zones</div>`;
  const botScore = el("div", "score-bot");
  botScore.innerHTML =
    `<div class="score-pts">BOT — <b>${bot.points}</b> pts` +
    (lastGain.P2 > 0 ? ` <span class="gain">+${lastGain.P2}</span>` : "") +
    `</div><div class="score-zones">holding ${zonesHeld(BOT)}/3 zones</div>`;
  score.appendChild(youScore);
  score.appendChild(botScore);
  app.appendChild(score);

  // Zones.
  const zonesEl = el("div", "zones");
  for (const z of ZONE_IDS) {
    const youP = game.zones[z].presence[HUMAN];
    const botP = game.zones[z].presence[BOT];
    const ctrl = youP > botP ? "you" : botP > youP ? "bot" : "tie";
    const targetable = (selectedCard || abilityTargeting) && !pending && !result;
    const zone = el("div", `zone zone-${ctrl}` + (targetable ? " zone-targetable" : ""));
    const nameRow = el("div", "zone-name-row");
    nameRow.appendChild(el("span", "zone-name", z));
    if (ctrl !== "tie") nameRow.appendChild(el("span", `zone-pip pip-${ctrl}`, "★ +1"));
    zone.appendChild(nameRow);
    const ctrlLabel = ctrl === "you" ? "YOU control" : ctrl === "bot" ? "BOT controls" : "contested";
    zone.appendChild(el("div", "zone-ctrl", ctrlLabel));
    const max = Math.max(youP, botP, 1);
    const you = el("div", "zone-side you");
    you.innerHTML = `<span class="num">${youP}</span> <span class="bargraph">${bar(youP, max, "▰")}</span>`;
    const bo = el("div", "zone-side bot");
    bo.innerHTML = `<span class="bargraph">${bar(botP, max, "▰")}</span> <span class="num">${botP}</span>`;
    zone.appendChild(you);
    zone.appendChild(bo);
    if (targetable) zone.addEventListener("click", () => onPickZone(z));
    zonesEl.appendChild(zone);
  }
  app.appendChild(zonesEl);

  // Action log — ONLY card plays now (control/scoring moved to the scoreboard & zones).
  const logEl = el("div", "log");
  logEl.appendChild(el("div", "log-head", "LAST TURN"));
  const relabel = (l: string) => l.replaceAll("P1", "YOU").replaceAll("P2", "BOT");
  const isPlay = (l: string) => /plays|casts|passes|uses|afford|in hand/.test(l);
  const lines = game.log.slice(lastLogLen).filter(isPlay);
  if (lines.length === 0) logEl.appendChild(el("div", "log-line muted", "Your move — pick a card."));
  for (const line of lines) {
    const cls = line.includes("P1") ? "log-line you" : line.includes("P2") ? "log-line bot" : "log-line";
    logEl.appendChild(el("div", cls, relabel(line.trim())));
  }
  app.appendChild(logEl);

  // Reveal beat.
  if (pending) {
    const reveal = el("div", "resolving");
    reveal.appendChild(el("div", "resolving-title", "● LOCKED IN — RESOLVING…"));
    reveal.appendChild(el("div", "resolving-line you", `YOU: ${describeAction(pending.human)}`));
    reveal.appendChild(el("div", "resolving-line bot", "BOT: revealing…"));
    app.appendChild(reveal);
    app.appendChild(matchControls());
    return;
  }

  // Result or hand.
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
    app.appendChild(matchControls());
    return;
  }

  // Hero ability.
  app.appendChild(abilityPanel());

  // Hand.
  const sel = selectedCard ? cardDef(selectedCard) : null;
  const handWrap = el("div", "hand-wrap");
  const abilityName = heroDef(humanHeroId).ability.name;
  const prompt = abilityTargeting
    ? `▶ Click a zone to aim ${abilityName}`
    : sel
      ? sel.allZones
        ? "▶ Hits ALL zones — press Cast Everywhere (or click any zone)"
        : "▶ Now click a zone to play it"
      : "Pick a card to play" + (armedAbility ? ` (${abilityName} aimed → ${armedAbility})` : "");
  handWrap.appendChild(el("div", "hand-prompt", prompt));

  if (sel?.allZones) {
    const cast = el("button", "btn btn-primary", "Cast Everywhere");
    cast.addEventListener("click", () => commitCard(sel.id, ZONE_IDS[0]!));
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
  app.appendChild(matchControls());
}

function abilityPanel(): HTMLElement {
  const p = game.players[HUMAN];
  const ab = heroDef(humanHeroId).ability;
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

function matchControls(): HTMLElement {
  const row = el("div", "controls");
  const result = checkWinCondition(game);
  if (result) {
    const again = el("button", "btn btn-primary", "Play again");
    again.addEventListener("click", startMatch);
    row.appendChild(again);
  } else {
    const pass = el("button", "btn", "Pass turn");
    pass.addEventListener("click", onPass);
    if (pending) (pass as HTMLButtonElement).disabled = true;
    row.appendChild(pass);
  }
  const back = el("button", "btn btn-ghost", "↩ Hero select");
  back.addEventListener("click", () => {
    screen = "select";
    render();
  });
  row.appendChild(back);
  return row;
}

// ---------- dispatch ----------

function render(): void {
  if (screen === "select") renderSelect();
  else renderMatch();
}

render();
