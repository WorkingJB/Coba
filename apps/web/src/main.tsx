import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CARDS, HEROES, ZONES, type CardId, type Hero } from '../../../packages/game/src/content.js';
import type { Zone } from '../../../packages/game/src/engine.js';
import type { MatchView } from '../../api/src/store.js';
import './style.css';

class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, { method: body ? 'POST' : 'GET', credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000) });
  const value = await response.json();
  if (!response.ok) throw new ApiError(response.status, value.error ?? 'Connection interrupted. Try again.');
  return value as T;
}
function App() {
  const [signedIn, setSignedIn] = useState(false);
  const [checking, setChecking] = useState(true);
  const [key, setKey] = useState('');
  const [hero, setHero] = useState<Hero>('warden');
  const [code, setCode] = useState('');
  const [match, setMatch] = useState<MatchView | null>(null);
  const [matchId, setMatchId] = useState<string | null>(() => localStorage.getItem('coba.match'));
  const [card, setCard] = useState<CardId | null>(null);
  const [zone, setZone] = useState<Zone>(1);
  const [ability, setAbility] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connection, setConnection] = useState('Connecting');
  const [now, setNow] = useState(Date.now());
  // Persist the command envelope before transmission: a dropped response can be retried verbatim.
  const pending = useRef<{ matchId: string; commandId: string; turn: number; action: { card: CardId | null; zone: Zone; ability: boolean } } | null>(null);
  const createId = useRef(crypto.randomUUID());
  useEffect(() => {
    try { pending.current = JSON.parse(localStorage.getItem('coba.pending') ?? 'null'); } catch { localStorage.removeItem('coba.pending'); }
    void api('session').then(() => setSignedIn(true)).catch(() => {}).finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    if (!signedIn || !matchId) return;
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    async function poll() {
      try {
        const next = await api<MatchView>(`matches/${matchId}`);
        if (stopped) return;
        setMatch(old => !old || next.revision >= old.revision ? next : old);
        setConnection('Connected'); failures = 0;
      } catch (err) {
        if (stopped) return;
        failures++; setConnection('Reconnecting… Your locked move is saved.');
        if (err instanceof ApiError && err.status === 401) { setSignedIn(false); setError(err.message); }
        if (err instanceof ApiError && err.status === 404) { setMatchId(null); localStorage.removeItem('coba.match'); setError(err.message); }
      }
      if (!stopped) timer = setTimeout(() => void poll(), Math.min(1000 * 2 ** failures, 8000));
    }
    void poll(); return () => { stopped = true; clearTimeout(timer); };
  }, [signedIn, matchId]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(timer); }, []);
  const game = match?.game;
  const me = game?.players.find(p => p.id === match?.you);
  useEffect(() => {
    if (!game) return;
    setCard(null); setAbility(false);
    if (pending.current && (pending.current.turn !== game?.turn || me?.locked || game?.status === 'finished')) {
      pending.current = null; localStorage.removeItem('coba.pending');
    }
  }, [game?.turn, me?.locked, game?.status]);
  async function perform(fn: () => Promise<void>) {
    setBusy(true); setError(''); try { await fn(); } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong.'); } finally { setBusy(false); }
  }
  function enter(value: MatchView) {
    setMatch(value); setMatchId(value.id); localStorage.setItem('coba.match', value.id);
  }
  async function submit() {
    if (!match || !game) return;
    if (!pending.current || pending.current.matchId !== match.id || pending.current.turn !== game.turn) {
      pending.current = { matchId: match.id, commandId: crypto.randomUUID(), turn: game.turn, action: { card, zone, ability } };
      localStorage.setItem('coba.pending', JSON.stringify(pending.current));
    }
    const { matchId: id, ...body } = pending.current;
    try {
      const next = await api<MatchView>(`matches/${id}/actions`, body);
      pending.current = null; localStorage.removeItem('coba.pending');
      setMatch(old => !old || next.revision >= old.revision ? next : old);
    } catch (err) {
      if (err instanceof ApiError && err.status < 500) { pending.current = null; localStorage.removeItem('coba.pending'); }
      throw err;
    }
  }
  function leave() { setMatch(null); setMatchId(null); localStorage.removeItem('coba.match'); createId.current = crypto.randomUUID(); }
  const enemy = me ? (me.team === 0 ? 1 : 0) : 1;
  const energy = Math.min(game?.turn ?? 1, 6);
  const remaining = Math.max(0, Math.ceil(((match?.deadline ? Date.parse(match.deadline) : now) - now) / 1000));
  const locked = me?.locked || game?.status === 'finished' || busy;
  return <div className="shell">
    <header className="masthead"><a href="/" className="brand" aria-label="Coba home">COBA<span>THE SHIFTING FRONT</span></a><div className="build"><i/> FIELD TEST · 001</div></header>
    {error && <div className="notice" role="alert">{error}<button aria-label="Dismiss message" onClick={() => setError('')}>×</button></div>}
    {!match && <main>
      <section className="intro"><div><p className="eyebrow">TACTICS. TRUST. TERRITORY.</p><h1>A small battle.<br/><em>A shifting world.</em></h1><p className="lede">Choose your hero. Read your rival. Commit together.<br/>Three zones. One front worth fighting for.</p></div><div className="map-art" aria-hidden="true"><div className="map-grid"/><span className="map-label north">THE RUINS</span><span className="map-label center">THE CITADEL</span><span className="map-label south">THE WILDS</span><div className="map-diamond d1"/><div className="map-diamond d2"/><div className="map-diamond d3"/><span className="map-caption">FRONTIER / 01 &nbsp; — &nbsp; NEUTRAL GROUND</span></div></section>
      <section className="briefing"><div><b>01</b><span>PLAN IN SECRET<small>One card, one zone. A signature ability when ready.</small></span></div><div><b>02</b><span>REVEAL TOGETHER<small>Both plans resolve at once. Every choice matters.</small></span></div><div><b>03</b><span>CONTROL THE FRONT<small>Each held zone earns a point. First to 15 wins.</small></span></div></section>
      <div className="section-title"><h2>Choose your approach</h2><span>01 / HERO SELECTION</span></div>
      <section className="hero-grid">{(Object.keys(HEROES) as Hero[]).map(id => <button key={id} className={`hero ${id} ${hero === id ? 'selected' : ''}`} aria-pressed={hero === id} onClick={() => setHero(id)}><span className="hero-symbol" aria-hidden="true">{id === 'warden' ? '♜' : '♞'}</span><span className="hero-copy"><small>{HEROES[id].role}</small><strong>{HEROES[id].name}</strong><span>{HEROES[id].description}</span><em>{HEROES[id].ability} · {HEROES[id].add} presence{HEROES[id].damage ? ` + ${HEROES[id].damage} removal` : ''}</em></span><span className="selection-dot">{hero === id ? '●' : '○'}</span></button>)}</section>
      <section className="play-panel"><div><p className="eyebrow">THE NEXT FRONT IS YOURS</p><h2>{signedIn ? 'Bring a worthy rival.' : 'Enter the private playtest.'}</h2><p>Invite a friend for a simultaneous 1v1 battle.</p></div>{checking ? <p>Restoring your session…</p> : !signedIn ? <form onSubmit={event => { event.preventDefault(); void perform(async () => { await api('session', { accessKey: key }); setKey(''); setSignedIn(true); }); }}><label htmlFor="access">Playtest key</label><div className="input-row"><input id="access" type="password" autoComplete="off" value={key} onChange={e => setKey(e.target.value)} required/><button className="primary" disabled={busy}>Enter playtest ↗</button></div></form> : <div className="room-actions"><button className="primary" disabled={busy} onClick={() => void perform(async () => enter(await api<MatchView>('matches', { id: createId.current, hero })))}>Create a battle ↗</button><form onSubmit={event => { event.preventDefault(); void perform(async () => enter(await api<MatchView>('join', { code: code.trim().toUpperCase(), hero }))); }}><label htmlFor="room">Or join with an invite code</label><div className="input-row"><input id="room" placeholder="10-character code" maxLength={10} value={code} onChange={e => setCode(e.target.value)} required/><button className="secondary" disabled={busy}>Join</button></div></form></div>}</section>
      <p className="footnote">A new beginning for Coba. The faction war is on the horizon; this field test focuses on the battle.</p>
    </main>}
    {match && !game && <main className="waiting"><p className="eyebrow">BATTLE CREATED</p><h1>The front awaits.</h1><p>Share this code with your rival. They can choose a hero and join from another browser.</p><div className="invite" aria-label="Invite code">{match.code}</div><button className="primary" onClick={() => void perform(async () => { await navigator.clipboard.writeText(match.code); })}>Copy invite code</button><p className="connection">{connection} · Waiting for a second player</p><button className="text-button" onClick={leave}>Back to hero selection</button></main>}
    {match && game && me && <main className="battle">
      <div className="battle-heading"><div><p className="eyebrow">NEUTRAL GROUND / {match.code}</p><h1>{game.status === 'finished' ? game.winner === 'draw' ? 'An even front.' : game.winner === me.team ? 'The front is yours.' : 'A battle to learn from.' : `Turn ${game.turn}`}<span className="round-cap"> / 16</span></h1></div><div className="clock"><strong>{game.status === 'finished' ? 'FINAL' : `${remaining}s`}</strong><span>{game.status === 'finished' ? game.reason : 'PLANNING WINDOW'}</span></div></div>
      <div className="scoreboard"><span className="your-score">YOU <strong>{game.scores[me.team]}</strong></span><span>CONTROL THE ZONES · REACH 15</span><span className="their-score"><strong>{game.scores[enemy]}</strong> RIVAL</span></div>
      <div className="zones">{ZONES.map((name, index) => { const own = game.board[index]![me.team]; const foe = game.board[index]![enemy]; return <button key={name} disabled={!!locked} aria-pressed={zone === index} onClick={() => setZone(index as Zone)} className={`zone ${zone === index ? 'targeted' : ''}`}><span className="eyebrow">ZONE 0{index + 1}</span><strong>{name}</strong><div className="zone-icon" aria-hidden="true">{['◇', '♜', '♧'][index]}</div><div className="presence"><span>{own}<small>YOUR PRESENCE</small></span><span>{foe}<small>RIVAL PRESENCE</small></span></div><span className={`control ${own > foe ? 'ours' : own < foe ? 'theirs' : ''}`}>{own === foe ? 'CONTESTED · NO POINTS' : own > foe ? 'YOUR CONTROL · +1 / TURN' : 'RIVAL CONTROL · +1 / TURN'}</span></button>; })}</div>
      {game.status === 'playing' ? <><div className="section-title"><h2>Your next move <small>{energy} energy · refreshes each turn</small></h2><span>{me.locked ? 'PLAN LOCKED' : 'SELECT A CARD & ZONE'}</span></div><div className="hand">{me.hand?.map((id, index) => <button key={`${id}-${index}`} className={`card ${card === id ? 'selected' : ''}`} aria-pressed={card === id} disabled={!!locked || CARDS[id].cost > energy} onClick={() => setCard(card === id ? null : id)}><span className="cost">{CARDS[id].cost}</span><small>TACTIC</small><strong>{CARDS[id].name}</strong><p>{CARDS[id].text}</p></button>)}</div><div className="commit-bar"><label className="ability"><input type="checkbox" checked={ability} disabled={!!locked || game.turn < me.abilityReadyTurn} onChange={e => setAbility(e.target.checked)}/><span>{HEROES[me.hero].ability}<small>{game.turn < me.abilityReadyTurn ? `Ready on turn ${me.abilityReadyTurn}` : 'Free · targets your selected zone · 4-turn cooldown'}</small></span></label><button className="primary" disabled={!!locked} onClick={() => void perform(submit)}>{me.locked ? 'Locked · waiting for rival' : pending.current ? 'Retry saved move ↗' : card || ability ? 'Lock your move ↗' : 'Pass this turn →'}</button></div><p className="footnote">Plans cannot change after locking. An expired timer passes your turn; three missed turns forfeit the match.</p></> : <div className="result-actions"><p>{game.reason === 'abandonment' ? 'The match ended after three consecutive missed turns.' : 'Every held zone made the difference.'}</p><button className="primary" onClick={leave}>Return to the front ↗</button></div>}
      <section className="history"><div className="section-title"><h2>The last exchange</h2><span>{connection}</span></div>{game.history.length === 0 ? <p>Your rival’s plan stays hidden until you both commit.</p> : [...game.history].reverse().slice(0, 3).map(round => <div className="round" key={round.turn}><b>TURN {round.turn}</b>{round.actions.map(item => <p key={item.player}><strong>{item.player === match.you ? 'You' : 'Rival'}</strong> {item.action.card ? `${CARDS[item.action.card].name} → ${ZONES[item.action.zone]}` : 'Passed'}{item.action.ability ? ` + ${HEROES[item.hero].ability}` : ''}{item.timedOut ? ' (timer expired)' : ''}</p>)}<span>Points: {round.points[me.team]} yours / {round.points[enemy]} rival</span></div>)}</section>
    </main>}
    <footer><span>COBA</span><span>A WORLD WON ONE DECISION AT A TIME.</span><span>PRIVATE ALPHA</span></footer>
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
