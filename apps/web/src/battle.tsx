// The frontier-2 battle screen: one fixed viewport, no scrolling. The front
// sits in the middle, both teams flank it, and the player's console (hand,
// ability, lock) runs along the bottom. A resolved turn is played back phase
// by phase from the engine's event list before the next plan begins.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CARDS,
  HEROES,
  THEATERS,
  TURN_MS,
  ZONES,
  describe,
  type Card,
  type CardId,
  type Effect,
  type Hero,
  type HeroDef,
  type Theater,
  type TheaterId,
} from "../../../packages/game/src/frontier2/content.js";
import type {
  Action,
  GameView,
  Hold,
  Reveal,
  Team,
  TurnEvent,
  Zone,
} from "../../../packages/game/src/frontier2/engine.js";
import type { MatchView } from "../../api/src/store.js";
import { isMuted, play as playSound, setMuted, type SoundName } from "./sound.js";

export type Frontier2Match = Extract<MatchView, { ruleset: "frontier-2" }>;
type Board = [number, number][];
// Widened lookups: every entry read through its full interface.
const CARD: Record<CardId, Card> = CARDS;
const HERO: Record<Hero, HeroDef> = HEROES;
const THEATER: Record<TheaterId, Theater> = THEATERS;
const ZONE_IDS: readonly Zone[] = [0, 1, 2];
const SHORT = ["Drydock", "Spindle", "Relay"] as const;

/** Two-letter mark standing in for a commander portrait until there is art. */
export function Sigil({ hero, small }: { hero: Hero; small?: boolean }) {
  return (
    <span className={`sigil ${small ? "small" : ""}`} data-hero={hero} aria-hidden="true">
      {HERO[hero].name.replace("The ", "").slice(0, 2).toUpperCase()}
    </span>
  );
}

/** Wireframe schematics: the tactical display's stand-in for zone art. */
function Schematic({ zone }: { zone: Zone }) {
  const common = {
    viewBox: "0 0 120 80",
    className: "schematic",
    "aria-hidden": true,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1,
  } as const;
  if (zone === 0)
    return (
      <svg {...common}>
        <path d="M10 18h100M10 62h100M14 18v44M106 18v44M34 18v8M60 18v8M86 18v8M34 62v-8M60 62v-8M86 62v-8" />
        <path d="M28 40l14-9h40l12 9-12 9H42z" />
        <path d="M42 31v18M70 31v18M82 40h12" opacity=".6" />
      </svg>
    );
  if (zone === 1)
    return (
      <svg {...common}>
        <path d="M60 6v68" />
        <ellipse cx="60" cy="40" rx="44" ry="11" />
        <ellipse cx="60" cy="40" rx="28" ry="7" opacity=".6" />
        <path d="M52 22h16v36H52zM16 40h12M92 40h12" />
        <circle cx="60" cy="10" r="3" />
        <circle cx="60" cy="70" r="3" />
      </svg>
    );
  return (
    <svg {...common}>
      <path d="M30 62c0-22 14-38 34-42M30 62c20 2 38-10 44-30M30 62l34-42 10 12z" />
      <path d="M52 38l22-22" />
      <circle cx="76" cy="14" r="3" />
      <path d="M84 22c6 6 9 13 9 21M92 14c9 9 13 20 13 32" opacity=".6" />
      <path d="M20 70h30M35 62v8" />
    </svg>
  );
}

function effectOf(game: GameView, id: CardId): Effect {
  return THEATER[game.theater].modify(CARD[id], CARD[id].type);
}
function abilityOf(game: GameView, hero: Hero): Effect {
  return THEATER[game.theater].modify(HERO[hero].ability, "ability");
}

/** One step of a turn's playback: the events shown and the board they leave. */
interface Frame {
  kind: "reveal" | TurnEvent["kind"];
  label: string;
  events: TurnEvent[];
  board: Board;
  scores: [number, number];
  holds: Hold[];
  ms: number;
}
const PHASES: { kind: TurnEvent["kind"]; label: string; sound: SoundName }[] = [
  { kind: "deploy", label: "Deployment", sound: "deploy" },
  { kind: "amplify", label: "Logistics", sound: "amplify" },
  { kind: "strike", label: "Strikes", sound: "strike" },
  { kind: "control", label: "Control", sound: "control" },
  { kind: "secure", label: "Zone secured", sound: "secure" },
];
function framesFor(
  reveal: Reveal,
  before: { board: Board; scores: [number, number]; holds: Hold[] },
  after: { holds: Hold[] },
): Frame[] {
  const board = before.board.map((z) => [...z]) as Board;
  const scores: [number, number] = [...before.scores];
  let holds = before.holds;
  const snapshot = (
    kind: Frame["kind"],
    label: string,
    events: TurnEvent[],
    ms: number,
  ): Frame => ({
    kind,
    label,
    events,
    board: board.map((z) => [...z]) as Board,
    scores: [...scores],
    holds,
    ms,
  });
  const frames = [snapshot("reveal", "Plans revealed", [], 1300)];
  for (const phase of PHASES) {
    const events = reveal.events.filter((e) => e.kind === phase.kind);
    if (!events.length) continue;
    for (const event of events) {
      const cell = board[event.zone]!;
      if (event.kind === "deploy" || event.kind === "amplify")
        cell[event.team] += event.amount;
      else if (event.kind === "strike") cell[event.team] -= event.amount;
      else if (event.kind === "control") {
        if (event.team !== null) scores[event.team] += event.points;
      } else {
        scores[event.team] += event.points;
        cell[0] = 0;
        cell[1] = 0;
      }
    }
    if (phase.kind === "control") holds = after.holds;
    frames.push(snapshot(phase.kind, phase.label, events, 1000));
  }
  return frames;
}

/**
 * Plays a newly resolved turn. It needs the board from before the turn, so a
 * turn that resolved while the page was closed is shown as finished instead.
 */
function usePlayback(game: GameView) {
  const seen = useRef<{
    turns: number;
    board: Board;
    scores: [number, number];
    holds: Hold[];
  } | null>(null);
  const [state, setState] = useState<{ frames: Frame[]; step: number; reveal: Reveal } | null>(
    null,
  );
  const turns = game.history.length;
  useEffect(() => {
    const before = seen.current;
    seen.current = {
      turns,
      board: game.board as Board,
      scores: game.scores as [number, number],
      holds: game.holds,
    };
    const reveal = game.history.at(-1);
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!before || !reveal || turns !== before.turns + 1 || calm) {
      setState(null);
      return;
    }
    setState({ frames: framesFor(reveal, before, game), step: 0, reveal });
  }, [turns]);
  useEffect(() => {
    if (!state) return;
    const frame = state.frames[state.step]!;
    if (frame.kind === "reveal") playSound("reveal");
    else playSound(PHASES.find((p) => p.kind === frame.kind)!.sound);
    const timer = setTimeout(
      () =>
        setState((now) =>
          !now || now !== state
            ? now
            : now.step + 1 < now.frames.length
              ? { ...now, step: now.step + 1 }
              : null,
        ),
      frame.ms,
    );
    return () => clearTimeout(timer);
  }, [state]);
  return {
    frame: state ? state.frames[state.step]! : null,
    reveal: state?.reveal ?? null,
    step: state?.step ?? 0,
    skip: () => setState(null),
  };
}

interface Staged {
  /** Position in the hand, so two copies of a card stay distinct. */
  index: number;
  card: CardId;
  zone: Zone;
}
type Picked = { kind: "card"; index: number } | { kind: "ability" } | null;
interface Chip {
  key: string;
  label: string;
  hero: Hero;
  side: "ally" | "enemy";
  wide: boolean;
  remove?: () => void;
}

export function Battle(props: {
  match: Frontier2Match;
  game: GameView;
  now: number;
  connection: string;
  busy: boolean;
  /** A plan that was sent but not yet acknowledged; locking retries it. */
  retry: boolean;
  onLock: (action: Action) => void;
  onLeave: () => void;
  /** Present when the match can be replayed with the same setup. */
  onAgain?: () => void;
}) {
  const { match, game } = props;
  const me = game.players.find((p) => p.id === match.you)!;
  const foe: Team = me.team === 0 ? 1 : 0;
  const playback = usePlayback(game);
  const frame = playback.frame;
  const [plays, setPlays] = useState<Staged[]>([]);
  const [ability, setAbility] = useState<Zone | null>(null);
  const [picked, setPicked] = useState<Picked>(null);
  const [hint, setHint] = useState("");
  const [muted, setMutedState] = useState(isMuted());
  const [showLog, setShowLog] = useState(false);
  const ghost = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    setPlays([]);
    setAbility(null);
    setPicked(null);
    setHint("");
  }, [game.turn, match.id]);
  const finished = game.status === "finished";
  useEffect(() => {
    if (finished && !frame)
      playSound(game.winner === me.team ? "win" : game.winner === "draw" ? "control" : "lose");
  }, [finished, !frame]);

  const planning = !finished && !frame && !me.locked && !props.busy;
  const hand = me.hand ?? [];
  const spent = plays.reduce((sum, p) => sum + CARD[p.card].cost, 0);
  const left = game.energy - spent;
  const abilityReady = game.turn >= me.abilityReadyTurn;
  const heroDef = HERO[me.hero];

  function deny(message: string) {
    setHint(message);
    playSound("deny");
  }
  function stage(index: number, zone: Zone) {
    const id = hand[index];
    if (!planning || !id) return;
    const existing = plays.find((p) => p.index === index);
    if (existing) {
      setPlays(plays.map((p) => (p.index === index ? { ...p, zone } : p)));
    } else {
      if (plays.length >= game.rules.maxPlays)
        return deny(`A plan holds at most ${game.rules.maxPlays} cards.`);
      if (CARD[id].cost > left)
        return deny(`${CARD[id].name} costs ${CARD[id].cost}; you have ${left} energy left.`);
      setPlays([...plays, { index, card: id, zone }]);
    }
    setPicked(null);
    setHint("");
    playSound("place");
  }
  function unstage(index: number) {
    setPlays(plays.filter((p) => p.index !== index));
    setPicked(null);
    playSound("remove");
  }
  function aim(zone: Zone) {
    if (!planning) return;
    if (!abilityReady) return deny(`${heroDef.ability.name} is ready on turn ${me.abilityReadyTurn}.`);
    setAbility(zone);
    setPicked(null);
    setHint("");
    playSound("place");
  }
  function pick(next: Picked) {
    if (!planning || suppressClick.current) return;
    if (next?.kind === "card") {
      if (plays.some((p) => p.index === next.index)) return unstage(next.index);
      const id = hand[next.index]!;
      if (CARD[id].cost > left && !(picked?.kind === "card" && picked.index === next.index))
        return deny(`${CARD[id].name} costs ${CARD[id].cost}; you have ${left} energy left.`);
    }
    if (next?.kind === "ability") {
      if (!abilityReady) return deny(`${heroDef.ability.name} is ready on turn ${me.abilityReadyTurn}.`);
      if (ability !== null) {
        setAbility(null);
        setPicked(null);
        return playSound("remove");
      }
    }
    const same =
      picked &&
      next &&
      picked.kind === next.kind &&
      (picked.kind !== "card" || (next.kind === "card" && picked.index === next.index));
    setPicked(same ? null : next);
    setHint("");
    playSound("pick");
  }
  function drop(what: Picked, zone: Zone) {
    if (what?.kind === "card") stage(what.index, zone);
    else if (what?.kind === "ability") aim(zone);
  }
  // Pointer events rather than HTML drag-and-drop, so touch works the same way.
  const latestDrop = useRef(drop);
  latestDrop.current = drop;
  function dragFrom(what: NonNullable<Picked>, label: string) {
    return (event: React.PointerEvent) => {
      if (!planning || event.button !== 0) return;
      const startX = event.clientX;
      const startY = event.clientY;
      const far = (e: PointerEvent) => Math.hypot(e.clientX - startX, e.clientY - startY) > 8;
      const over = (e: PointerEvent) =>
        document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-zone]") ?? null;
      let dragging = false;
      let lit: HTMLElement | null = null;
      const light = (target: HTMLElement | null) => {
        if (lit === target) return;
        lit?.classList.remove("over");
        target?.classList.add("over");
        lit = target;
      };
      const move = (e: PointerEvent) => {
        const el = ghost.current;
        if (!el) return;
        if (!dragging && far(e)) {
          dragging = true;
          el.textContent = label;
          el.hidden = false;
          document.body.classList.add("dragging");
        }
        if (!dragging) return;
        el.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
        light(over(e));
      };
      const finish = (e: PointerEvent, cancelled: boolean) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        light(null);
        document.body.classList.remove("dragging");
        if (ghost.current) ghost.current.hidden = true;
        if (cancelled || !far(e)) return;
        // The click that follows a drag must not also select the card.
        suppressClick.current = true;
        setTimeout(() => (suppressClick.current = false), 0);
        const target = over(e);
        if (target) latestDrop.current(what, Number(target.dataset.zone) as Zone);
      };
      const up = (e: PointerEvent) => finish(e, false);
      const cancel = (e: PointerEvent) => finish(e, true);
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
    };
  }
  function zoneClick(zone: Zone) {
    if (picked) drop(picked, zone);
    else if (planning) setHint("Pick a card or your ability first, then a zone.");
  }

  // What each zone shows: the board (or the playback frame) and the plans in it.
  const board = frame?.board ?? (game.board as Board);
  const scores = frame?.scores ?? (game.scores as [number, number]);
  const holds = frame?.holds ?? game.holds;
  const chips = useMemo(() => {
    const perZone: Chip[][] = [[], [], []];
    const put = (
      owner: { id: string; hero: Hero; team: Team },
      action: Action,
      removable: boolean,
    ) => {
      const side = owner.team === me.team ? "ally" : "enemy";
      action.plays.forEach((p, i) => {
        const wide = !!CARD[p.card].all;
        for (const z of ZONE_IDS)
          if (wide || p.zone === z)
            perZone[z]!.push({
              key: `${owner.id}-${i}`,
              label: CARD[p.card].name,
              hero: owner.hero,
              side,
              wide,
              ...(removable ? { remove: () => unstage(plays[i]!.index) } : {}),
            });
      });
      if (action.ability !== null) {
        const wide = !!HERO[owner.hero].ability.all;
        for (const z of ZONE_IDS)
          if (wide || action.ability === z)
            perZone[z]!.push({
              key: `${owner.id}-ability`,
              label: HERO[owner.hero].ability.name,
              hero: owner.hero,
              side,
              wide,
              ...(removable
                ? {
                    remove: () => {
                      setAbility(null);
                      playSound("remove");
                    },
                  }
                : {}),
            });
      }
    };
    if (playback.reveal && frame) {
      for (const entry of playback.reveal.actions)
        put({ id: entry.player, hero: entry.hero, team: entry.team }, entry.action, false);
    } else if (!finished) {
      for (const p of game.players) {
        if (p.id === me.id && !me.locked)
          put(p, { plays: plays.map(({ card, zone }) => ({ card, zone })), ability }, true);
        else if (p.plan) put(p, p.plan, false);
      }
    }
    return perZone;
  }, [game, plays, ability, frame, playback.reveal]);

  /** What the team's visible plans add and remove in a zone, before the enemy acts. */
  function projection(zone: Zone) {
    let add = 0;
    let amp = 0;
    let damage = 0;
    let frac = 0;
    const apply = (effect: Effect, target: Zone) => {
      if (!effect.all && target !== zone) return;
      add += effect.add ?? 0;
      amp += effect.amplify ?? 0;
      damage += effect.damage ?? 0;
      frac += effect.damageFrac ?? 0;
    };
    for (const p of game.players) {
      if (p.team !== me.team) continue;
      const action: Action | undefined =
        p.id === me.id && !me.locked ? { plays, ability } : p.plan;
      if (!action) continue;
      for (const play of action.plays) apply(effectOf(game, play.card), play.zone);
      if (action.ability !== null) apply(abilityOf(game, p.hero), action.ability);
    }
    return { add: add + Math.floor(add * amp), damage, frac };
  }

  const remaining = Math.max(
    0,
    Math.ceil(((match.deadline ? Date.parse(match.deadline) : props.now) - props.now) / 1000),
  );
  const waiting = game.players.filter((p) => !p.locked).length;
  const status = finished
    ? ""
    : frame
      ? `Turn ${playback.reveal!.turn} resolving`
      : me.locked
        ? `Plan locked. Waiting for ${waiting} ${waiting === 1 ? "commander" : "commanders"}.`
        : hint ||
          (picked
            ? "Now choose a zone."
            : "Drag a card onto a zone, or pick a card and then a zone.");
  const shownTurn = frame ? playback.reveal!.turn : game.turn;
  const lastTurn = game.history.at(-1);
  const sideOf = (team: Team) => (team === me.team ? "ally" : "enemy");
  const own = (cell: [number, number]) => cell[me.team];
  const theirs = (cell: [number, number]) => cell[foe];

  function roster(team: Team) {
    return (
      <aside className={`roster ${sideOf(team)}`} aria-label={team === me.team ? "Your team" : "Enemy team"}>
        <h2>{team === me.team ? "Your fleet" : "Hostile fleet"}</h2>
        {game.players
          .filter((p) => p.team === team)
          .map((p) => (
            <div className={`pilot ${p.locked && !finished ? "locked" : ""}`} key={p.id}>
              <Sigil hero={p.hero} />
              <div className="pilot-text">
                <strong>{HERO[p.hero].name}</strong>
                <small>
                  {p.id === me.id ? "You" : p.bot ? "Bot" : team === me.team ? "Wing" : "Rival"}
                  {" · "}
                  {p.handCount} cards
                  {game.turn < p.abilityReadyTurn ? ` · ability T${p.abilityReadyTurn}` : " · ability ready"}
                </small>
              </div>
              <span className="lock-state">{finished ? "" : p.locked ? "LOCKED" : "PLANNING"}</span>
            </div>
          ))}
        {team !== me.team && (
          <div className={`log ${showLog ? "open" : ""}`}>
            <h2>Last exchange</h2>
            {!lastTurn ? (
              <p>Plans stay hidden until every commander has locked.</p>
            ) : (
              lastTurn.actions.map((entry) => (
                <p key={entry.player} className={sideOf(entry.team)}>
                  <Sigil hero={entry.hero} small />
                  <span>
                    {[
                      ...entry.action.plays.map(
                        (p) => `${CARD[p.card].name} → ${CARD[p.card].all ? "all" : SHORT[p.zone]}`,
                      ),
                      ...(entry.action.ability !== null
                        ? [
                            `${HERO[entry.hero].ability.name} → ${
                              HERO[entry.hero].ability.all ? "all" : SHORT[entry.action.ability]
                            }`,
                          ]
                        : []),
                    ].join(", ") || (entry.timedOut ? "Timed out" : "Passed")}
                  </span>
                </p>
              ))
            )}
          </div>
        )}
      </aside>
    );
  }

  return (
    <main className={`battle ${frame ? "resolving" : ""}`} data-phase={frame?.kind ?? "plan"}>
      <header className="hud">
        <div className="hud-turn">
          {frame ? (
            <small className="phase" role="status">
              {frame.label}
            </small>
          ) : (
            <small>{THEATER[game.theater].name}</small>
          )}
          <h1>
            Turn {shownTurn} <span>of {game.rules.maxTurns}</span>
          </h1>
        </div>
        <div className="scoreline" aria-label={`Score: you ${own(scores)}, enemy ${theirs(scores)}, first to ${game.rules.targetScore}`}>
          <strong className="ally">{own(scores)}</strong>
          <div className="track">
            <i className="ally" style={{ width: `${Math.min(50, (own(scores) / game.rules.targetScore) * 50)}%` }} />
            <span>FIRST TO {game.rules.targetScore}</span>
            <i className="enemy" style={{ width: `${Math.min(50, (theirs(scores) / game.rules.targetScore) * 50)}%` }} />
          </div>
          <strong className="enemy">{theirs(scores)}</strong>
        </div>
        <div className="hud-tools">
          {!finished && (
            <div className={`timer ${remaining <= 10 && !frame ? "urgent" : ""}`} aria-label={`${remaining} seconds left`}>
              <i style={{ width: `${Math.min(100, (remaining * 1000 * 100) / TURN_MS)}%` }} />
              <span>{remaining}s</span>
            </div>
          )}
          <button className="tool log-toggle" onClick={() => setShowLog(!showLog)} aria-pressed={showLog}>
            Log
          </button>
          <button
            className="tool"
            aria-pressed={!muted}
            onClick={() => {
              setMuted(!muted);
              setMutedState(!muted);
              if (muted) playSound("pick");
            }}
          >
            {muted ? "Sound off" : "Sound on"}
          </button>
          <button className="tool" onClick={props.onLeave}>
            Leave
          </button>
        </div>
      </header>

      {roster(me.team)}

      <section className="front" aria-label="The front">
        {ZONE_IDS.map((z) => {
          const cell = board[z]!;
          const a = own(cell);
          const b = theirs(cell);
          const hold = holds[z]!;
          const plan = !frame && !finished ? projection(z) : null;
          const events = frame?.events.filter((e) => e.zone === z) ?? [];
          const lead = a === b ? "even" : a > b ? "ally" : "enemy";
          return (
            <div
              key={z}
              role="button"
              tabIndex={0}
              data-zone={z}
              className={`zone ${lead} ${picked ? "targetable" : ""}`}
              aria-label={`${ZONES[z]}: you ${a}, enemy ${b}`}
              onClick={() => zoneClick(z)}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  zoneClick(z);
                }
              }}
            >
              <div className="zone-head">
                <strong>{ZONES[z]}</strong>
                <span
                  className={`hold ${hold.team === null ? "" : sideOf(hold.team)}`}
                  title="Hold a zone three turns running to secure it"
                >
                  {Array.from({ length: game.rules.secureAfter }, (_, i) => (
                    <i key={i} className={i < hold.streak ? "on" : ""} />
                  ))}
                </span>
              </div>
              <Schematic zone={z} />
              <div className="presence">
                <b className="ally">{a}</b>
                <div className="tug">
                  <i style={{ width: `${a + b === 0 ? 50 : (a / (a + b)) * 100}%` }} />
                </div>
                <b className="enemy">{b}</b>
              </div>
              <div className="zone-state">
                {lead === "even" ? "Contested" : lead === "ally" ? "You hold · +1" : "Enemy holds · +1"}
                {plan && (plan.add > 0 || plan.damage > 0 || plan.frac > 0) && (
                  <em>
                    Plan{plan.add > 0 ? ` +${plan.add}` : ""}
                    {plan.damage > 0 ? ` −${plan.damage}` : ""}
                    {plan.frac > 0 ? ` −${Math.round(plan.frac * 100)}%` : ""}
                  </em>
                )}
              </div>
              <div className="chips">
                {chips[z]!.map((chip) =>
                  chip.remove ? (
                    <button
                      key={chip.key}
                      className={`chip ${chip.side} mine`}
                      title="Remove from plan"
                      onClick={(e) => {
                        e.stopPropagation();
                        chip.remove!();
                      }}
                    >
                      {chip.label}
                      {chip.wide ? " ⇔" : ""} ×
                    </button>
                  ) : (
                    <span key={chip.key} className={`chip ${chip.side}`}>
                      <Sigil hero={chip.hero} small />
                      {chip.label}
                      {chip.wide ? " ⇔" : ""}
                    </span>
                  ),
                )}
              </div>
              <div className="floaters" key={playback.step} aria-hidden="true">
                {events.map((e, i) => (
                  <span key={i} className={`floater ${e.kind} ${e.team === null ? "even" : sideOf(e.team)}`}>
                    {e.kind === "deploy" && `+${e.amount}`}
                    {e.kind === "amplify" && `+${e.amount} boost`}
                    {e.kind === "strike" &&
                      `−${e.amount}${e.ambush ? " ambush" : ""}${e.blocked ? ` · ${e.blocked} blocked` : ""}`}
                    {e.kind === "control" &&
                      (e.team === null ? "contested" : `+${e.points} · hold ${e.streak}/${game.rules.secureAfter}`)}
                    {e.kind === "secure" && `SECURED +${e.points}`}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {roster(foe)}

      <footer className="console">
        <div className="console-side">
          <div className="energy" aria-label={`${left} of ${game.energy} energy left`}>
            {Array.from({ length: game.rules.energyCap }, (_, i) => (
              <i key={i} className={i < left ? "on" : i < game.energy ? "spent" : ""} />
            ))}
            <span>
              {left}/{game.energy} energy
            </span>
          </div>
          <button
            className={`ability ${picked?.kind === "ability" ? "picked" : ""} ${ability !== null ? "staged" : ""}`}
            aria-disabled={!planning || !abilityReady}
            aria-pressed={picked?.kind === "ability"}
            onPointerDown={abilityReady ? dragFrom({ kind: "ability" }, heroDef.ability.name) : undefined}
            onClick={() => pick({ kind: "ability" })}
          >
            <Sigil hero={me.hero} small />
            <span>
              <strong>{heroDef.ability.name}</strong>
              <small>
                {ability !== null
                  ? `Aimed at ${heroDef.ability.all ? "the whole front" : SHORT[ability]}`
                  : abilityReady
                    ? describe(abilityOf(game, me.hero))
                    : `Recharging until turn ${me.abilityReadyTurn}`}
              </small>
            </span>
          </button>
        </div>
        <div className="hand" role="group" aria-label="Your hand">
          {hand.map((id, index) => {
            const def = CARD[id];
            const staged = plays.find((p) => p.index === index);
            const isPicked = picked?.kind === "card" && picked.index === index;
            const unaffordable = !staged && def.cost > left;
            return (
              <button
                key={`${id}-${index}`}
                className={`card ${def.type} ${staged ? "staged" : ""} ${isPicked ? "picked" : ""} ${unaffordable ? "unaffordable" : ""}`}
                data-name={def.name}
                aria-label={`${def.name}, cost ${def.cost}${staged ? `, planned for ${def.all ? "all zones" : ZONES[staged.zone]}` : ""}`}
                aria-pressed={isPicked}
                aria-disabled={!planning || unaffordable}
                onPointerDown={dragFrom({ kind: "card", index }, def.name)}
                onClick={() => pick({ kind: "card", index })}
              >
                <span className="cost">{def.cost}</span>
                <small>{def.type}</small>
                <strong>{def.name}</strong>
                <p>{describe(effectOf(game, id))}</p>
                {staged && <em>→ {def.all ? "All zones" : SHORT[staged.zone]}</em>}
              </button>
            );
          })}
        </div>
        <div className="console-side commit">
          <p className="status" role="status">
            {status}
          </p>
          {frame ? (
            <button className="secondary lock" onClick={playback.skip}>
              Skip playback
            </button>
          ) : (
          <button
            className="primary lock"
            disabled={!planning}
            onClick={() => {
              playSound("lock");
              props.onLock({ plays: plays.map(({ card, zone }) => ({ card, zone })), ability });
            }}
          >
            {finished
              ? "Match over"
              : me.locked
                ? "Plan locked"
                : props.retry
                  ? "Retry saved plan"
                  : plays.length || ability !== null
                    ? "Lock plan"
                    : "Pass turn"}
          </button>
          )}
          <small className="connection">{props.connection}</small>
        </div>
      </footer>

      {finished && !frame && (
        <div className="result" role="dialog" aria-label="Match result">
          <div>
            <small>
              {game.reason === "abandonment"
                ? "Ended by forfeit"
                : game.reason === "turn-limit"
                  ? "Turn limit reached"
                  : `First to ${game.rules.targetScore}`}
            </small>
            <h1 className={game.winner === "draw" ? "" : game.winner === me.team ? "ally" : "enemy"}>
              {game.winner === "draw" ? "Stalemate" : game.winner === me.team ? "Victory" : "Defeat"}
            </h1>
            <p className="final">
              <b className="ally">{own(scores)}</b> : <b className="enemy">{theirs(scores)}</b>
            </p>
            <p>after {game.history.length} turns</p>
            <div className="result-actions">
              {props.onAgain && (
                <button className="primary" disabled={props.busy} onClick={props.onAgain}>
                  Play again
                </button>
              )}
              <button className="secondary" onClick={props.onLeave}>
                Back to the bridge
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="ghost" ref={ghost} hidden />
    </main>
  );
}
