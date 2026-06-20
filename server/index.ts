// Single Fly.io app: the Colyseus match server AND (in production) the built
// web client, served from one process on one port. See ARCHITECTURE.md §4.

import { createServer } from "http";
import { fileURLToPath } from "url";
import path from "path";
import express from "express";
import cors from "cors";
import colyseus from "colyseus";
import wsTransport from "@colyseus/ws-transport";
import { toNodeHandler } from "better-auth/node";
import { CobaRoom } from "./CobaRoom.js";
import { auth } from "./auth.js";
import { pool } from "./db.js";

// CommonJS deps — default-import and destructure (see CobaRoom.ts).
const { Server } = colyseus;
const { WebSocketTransport } = wsTransport;

const PORT = Number(process.env.PORT ?? 2567);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "../dist");

// Host-based routing: APP_HOSTS lists the hosts that serve the GAME (app SPA +
// Colyseus + auth). Every other host (www, apex) gets the marketing "coming
// soon" page. Config-driven so staging (test.coba.games) and prod
// (app.coba.games) share one image. Defaults cover prod if the env is unset.
const APP_HOSTS = (process.env.APP_HOSTS ?? "app.coba.games,coba-prod.fly.dev")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);
const hostOf = (req: express.Request) => req.headers.host?.split(":")[0].toLowerCase() ?? "";
const isAppHost = (req: express.Request) => APP_HOSTS.includes(hostOf(req));

// Basic RFC-ish email shape check for the public waitlist endpoint.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const app = express();
// Auth needs credentialed CORS with explicit origins (a wildcard origin can't
// carry cookies). Same-origin in every deployed env, so this only matters for
// local dev (client on :5173 → matchmaking/auth on :2567), but be explicit.
app.use(
  cors({
    origin: [
      "https://app.coba.games",
      "https://test.coba.games",
      "https://www.coba.games",
      "https://www-test.coba.games",
      "https://coba.games",
      "http://localhost:5173",
    ],
    credentials: true,
  }),
);
app.get("/health", (_req, res) => res.json({ ok: true }));

// Better Auth HTTP handler. MUST come before express.json() (it reads the raw
// body itself) and before the SPA catch-all (so /api/auth/* isn't swallowed by
// index.html). Express 4 needs a regex/splat that matches the subpath.
app.all("/api/auth/*", toNodeHandler(auth));
app.use(express.json());

// Preview waitlist. Public, unauthenticated. Stores the email on the marketing
// site's "join the preview" form; you approve it later (npm run approve) and
// only then can that email create an account (gate in server/auth.ts). The
// response is intentionally uniform so it never leaks whether an email is new.
app.post("/api/waitlist", async (req, res) => {
  const email = String((req.body as { email?: unknown })?.email ?? "").trim();
  if (!EMAIL_RE.test(email) || email.length > 254) {
    res.status(400).json({ ok: false, message: "Please enter a valid email address." });
    return;
  }
  try {
    await pool.query(
      "INSERT INTO preview_signups (email) VALUES ($1) ON CONFLICT (email) DO NOTHING",
      [email],
    );
    res.json({ ok: true, message: "You're on the list — we'll email you when your preview is ready." });
  } catch (err) {
    console.error("waitlist insert failed", err);
    res.status(500).json({ ok: false, message: "Something went wrong. Please try again." });
  }
});

// Canonical host: 301 the apex (coba.games) → www.coba.games (the marketing
// site), preserving path + query. Apex-specific, so the *.fly.dev and game
// hosts are untouched.
app.use((req, res, next) => {
  if (hostOf(req) === "coba.games") {
    res.redirect(301, `https://www.coba.games${req.url}`);
    return;
  }
  next();
});

// Serve built assets (dist/ exists after `vite build`). index:false so `/`
// falls through to the host-aware catch-all below instead of auto-serving the
// game's index.html on every host.
app.use(express.static(DIST, { index: false }));
// Host routing: game hosts get the SPA (dist/index.html); www/apex get the
// marketing page (dist/marketing.html). See APP_HOSTS above.
app.get("*", (req, res) => {
  res.sendFile(path.join(DIST, isAppHost(req) ? "index.html" : "marketing.html"));
});

const httpServer = createServer(app);
const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });

// Private rooms: both players pass { code }; filterBy routes the joiner to the
// host's room. Host uses client.create, joiner uses client.join, so a wrong
// code fails fast instead of silently spawning an empty room.
gameServer.define("coba", CobaRoom).filterBy(["code"]);

// Public auto-queue: no code filter, so joinOrCreate fills the first open room
// (maxClients=2) and spins up a new one only when none is waiting. Same room
// logic — these matches simply have no shareable code.
gameServer.define("coba_quick", CobaRoom);

gameServer.listen(PORT).then(() => {
  console.log(`Coba server listening on :${PORT}`);
});
