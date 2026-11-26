import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  HEROES,
  HERO_IDS,
  describe,
  type Hero,
  type HeroDef,
} from "../../../packages/game/src/frontier2/content.js";
import type { Action } from "../../../packages/game/src/frontier2/engine.js";
import type { MatchView } from "../../api/src/store.js";
import { api, ApiError } from "./api.js";
import { Battle, Sigil } from "./battle.js";
import "./style.css";

const HERO: Record<Hero, HeroDef> = HEROES;
function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
interface Envelope {
  matchId: string;
  commandId: string;
  turn: number;
  action: Action;
}

function App() {
  const [signedIn, setSignedIn] = useState(false);
  const [checking, setChecking] = useState(true);
  const [key, setKey] = useState("");
  const [hero, setHero] = useState<Hero>(() => {
    const saved = stored("coba.commander");
    return HERO_IDS.includes(saved as Hero) ? (saved as Hero) : "marshal";
  });
  const [code, setCode] = useState("");
  const [side, setSide] = useState<"any" | "0" | "1">("any");
  const [match, setMatch] = useState<MatchView | null>(null);
  const [matchId, setMatchId] = useState<string | null>(() => stored("coba.match"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState("Connecting");
  const [now, setNow] = useState(Date.now());
  // Persist the command envelope before transmission: a dropped response can be retried verbatim.
  const pending = useRef<Envelope | null>(null);
  const createId = useRef(crypto.randomUUID());

  useEffect(() => {
    try {
      pending.current = JSON.parse(stored("coba.pending") ?? "null");
    } catch {
      localStorage.removeItem("coba.pending");
    }
    void api("session")
      .then(() => setSignedIn(true))
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    if (!signedIn || !matchId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    async function poll() {
      try {
        const next = await api<MatchView>(`matches/${matchId}`);
        if (stopped) return;
        setMatch((old) => (!old || next.revision >= old.revision ? next : old));
        setConnection("Connected");
        failures = 0;
        if (next.status === "finished") return;
      } catch (err) {
        if (stopped) return;
        failures++;
        setConnection("Reconnecting. Your locked plan is saved.");
        if (err instanceof ApiError && err.status === 401) {
          setSignedIn(false);
          setMatch(null);
          setError(err.message);
        }
        if (err instanceof ApiError && err.status === 404) {
          setMatch(null);
          setMatchId(null);
          localStorage.removeItem("coba.match");
          setError(err.message);
        }
      }
      if (!stopped) timer = setTimeout(() => void poll(), Math.min(1000 * 2 ** failures, 8000));
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [signedIn, matchId]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  const game = match?.ruleset === "frontier-2" ? match.game : null;
  const me = game?.players.find((p) => p.id === match?.you);
  useEffect(() => {
    if (
      pending.current &&
      game &&
      (pending.current.turn !== game.turn || me?.locked || game.status === "finished")
    ) {
      pending.current = null;
      localStorage.removeItem("coba.pending");
    }
  }, [game?.turn, me?.locked, game?.status]);

  async function perform(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }
  function enter(value: MatchView) {
    setMatch(value);
    setMatchId(value.id);
    localStorage.setItem("coba.match", value.id);
  }
  function leave() {
    setMatch(null);
    setMatchId(null);
    localStorage.removeItem("coba.match");
  }
  function choose(id: Hero) {
    setHero(id);
    localStorage.setItem("coba.commander", id);
  }
  /** size: seats in the match. bots: fill the rest and start at once. */
  function create(size: 2 | 4, bots: boolean) {
    void perform(async () => {
      const value = await api<MatchView>("matches", {
        id: createId.current,
        hero,
        ruleset: "frontier-2",
        size,
        bots,
      });
      // The same identifier is reused only to retry a create that failed.
      createId.current = crypto.randomUUID();
      enter(value);
    });
  }
  async function lock(action: Action) {
    if (!match || !game) return;
    if (
      !pending.current ||
      pending.current.matchId !== match.id ||
      pending.current.turn !== game.turn
    ) {
      pending.current = {
        matchId: match.id,
        commandId: crypto.randomUUID(),
        turn: game.turn,
        action,
      };
      localStorage.setItem("coba.pending", JSON.stringify(pending.current));
    }
    const { matchId: id, ...body } = pending.current;
    try {
      const next = await api<MatchView>(`matches/${id}/actions`, body);
      pending.current = null;
      localStorage.removeItem("coba.pending");
      setMatch((old) => (!old || next.revision >= old.revision ? next : old));
    } catch (err) {
      if (err instanceof ApiError && err.status < 500) {
        pending.current = null;
        localStorage.removeItem("coba.pending");
      }
      throw err;
    }
  }

  const notice = error && (
    <div className="notice" role="alert">
      {error}
      <button aria-label="Dismiss message" onClick={() => setError("")}>
        ×
      </button>
    </div>
  );

  if (match?.ruleset === "frontier-2" && game) {
    const people = match.seats.filter((seat) => !seat.bot).length;
    return (
      <>
        {notice}
        <Battle
          match={match}
          game={game}
          now={now}
          connection={connection}
          busy={busy}
          retry={!!pending.current}
          onLock={(action) => void perform(() => lock(action))}
          onLeave={leave}
          // Only a match against bots can be dealt again without asking anyone.
          {...(people === 1
            ? {
                onAgain: () => {
                  const size = match.size === 4 ? 4 : 2;
                  leave();
                  create(size, true);
                },
              }
            : {})}
        />
      </>
    );
  }

  return (
    <div className="shell">
      <header className="masthead">
        <a href="/" className="brand" aria-label="Coba home">
          COBA<span>THE SHIFTING FRONT</span>
        </a>
        <div className="build">
          <i /> FIELD TEST · 002
        </div>
      </header>
      {notice}
      {match && match.ruleset !== "frontier-2" && (
        <main className="waiting">
          <p className="eyebrow">OLDER MATCH</p>
          <h1>This match uses earlier rules.</h1>
          <p>It was created under {match.ruleset}, which this client no longer plays. The match itself is still saved.</p>
          <button className="primary" onClick={leave}>
            Back to the bridge
          </button>
        </main>
      )}
      {match?.ruleset === "frontier-2" && !game && (
        <main className="waiting">
          <p className="eyebrow">{match.size === 4 ? "TWO AGAINST TWO" : "DUEL"} · LOBBY OPEN</p>
          <h1>Assemble the fleets.</h1>
          <p>Share this code. Anyone who joins picks a commander and a side.</p>
          <div className="invite" aria-label="Invite code">
            {match.code}
          </div>
          <div className="seats">
            {([0, 1] as const).map((team) => (
              <div key={team} className={team === 0 ? "ally" : "enemy"}>
                <h2>{team === 0 ? "Host's side" : "Opposing side"}</h2>
                {Array.from({ length: match.size / 2 }, (_, i) => {
                  const seat = match.seats.filter((s) => s.team === team)[i];
                  return seat ? (
                    <p key={i} className="seat filled">
                      <Sigil hero={seat.hero} small />
                      {HERO[seat.hero].name}
                      {seat.id === match.you ? " (you)" : ""}
                    </p>
                  ) : (
                    <p key={i} className="seat">
                      Open seat
                    </p>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="lobby-actions">
            <button
              className="secondary"
              onClick={() => void perform(async () => navigator.clipboard.writeText(match.code))}
            >
              Copy invite code
            </button>
            {match.host === match.you && (
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void perform(async () => enter(await api<MatchView>(`matches/${match.id}/start`, {})))
                }
              >
                Start now, bots fill open seats
              </button>
            )}
          </div>
          <p className="connection">
            {connection} · {match.seats.length} of {match.size} seats taken
          </p>
          <button className="text-button" onClick={leave}>
            Back to the bridge
          </button>
        </main>
      )}
      {!match && (
        <main className="bridge">
          <section className="intro">
            <p className="eyebrow">KESTREL REACH · CONTESTED SPACE</p>
            <h1>
              Three stations. <em>One front.</em>
            </h1>
            <p className="lede">
              Every commander plans in secret and commits at once. Hold a station to score. Hold it three
              turns running to secure it. First fleet to 16 takes the Reach.
            </p>
          </section>
          <div className="section-title">
            <h2>Choose your commander</h2>
            <span>01 / COMMAND</span>
          </div>
          <section className="hero-grid">
            {HERO_IDS.map((id) => (
              <button
                key={id}
                className={`hero ${hero === id ? "selected" : ""}`}
                aria-pressed={hero === id}
                onClick={() => choose(id)}
              >
                <Sigil hero={id} />
                <span className="hero-copy">
                  <small>{HERO[id].role}</small>
                  <strong>{HERO[id].name}</strong>
                  <span>{HERO[id].description}</span>
                  <em>
                    {HERO[id].ability.name}: {describe(HERO[id].ability)}
                  </em>
                </span>
              </button>
            ))}
          </section>
          <div className="section-title">
            <h2>{signedIn ? "Launch" : "Enter the private playtest"}</h2>
            <span>02 / DEPLOY</span>
          </div>
          {checking ? (
            <p className="connection">Restoring your session…</p>
          ) : !signedIn ? (
            <form
              className="play-panel"
              onSubmit={(event) => {
                event.preventDefault();
                void perform(async () => {
                  await api("session", { accessKey: key });
                  setKey("");
                  setSignedIn(true);
                });
              }}
            >
              <label htmlFor="access">Playtest key</label>
              <div className="input-row">
                <input
                  id="access"
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  required
                />
                <button className="primary" disabled={busy}>
                  Enter playtest
                </button>
              </div>
            </form>
          ) : (
            <section className="launch">
              <div className="mode">
                <h3>Play now</h3>
                <p>Bots take every other seat. Starts at once.</p>
                <button className="primary" disabled={busy} onClick={() => create(4, true)}>
                  Solo 2v2
                </button>
                <button className="secondary" disabled={busy} onClick={() => create(2, true)}>
                  Solo duel
                </button>
              </div>
              <div className="mode">
                <h3>Host friends</h3>
                <p>Get an invite code. Start when ready; bots fill open seats.</p>
                <button className="primary" disabled={busy} onClick={() => create(4, false)}>
                  Host 2v2 lobby
                </button>
                <button className="secondary" disabled={busy} onClick={() => create(2, false)}>
                  Host duel lobby
                </button>
              </div>
              <form
                className="mode"
                onSubmit={(event) => {
                  event.preventDefault();
                  void perform(async () =>
                    enter(
                      await api<MatchView>("join", {
                        code: code.trim().toUpperCase(),
                        hero,
                        ...(side === "any" ? {} : { team: Number(side) }),
                      }),
                    ),
                  );
                }}
              >
                <h3>Join a lobby</h3>
                <label htmlFor="room">Invite code</label>
                <input
                  id="room"
                  placeholder="10 characters"
                  maxLength={10}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                />
                <label htmlFor="side">Side</label>
                <select id="side" value={side} onChange={(e) => setSide(e.target.value as typeof side)}>
                  <option value="any">Whichever has room</option>
                  <option value="0">With the host</option>
                  <option value="1">Against the host</option>
                </select>
                <button className="secondary" disabled={busy}>
                  Join
                </button>
              </form>
            </section>
          )}
          <p className="footnote">
            Private field test. Commander, card and station names are placeholders, and the roster is not
            balanced yet.
          </p>
        </main>
      )}
      <footer className="colophon">
        <span>COBA</span>
        <span>PRIVATE ALPHA</span>
      </footer>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
