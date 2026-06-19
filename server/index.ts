// Single Fly.io app: the Colyseus match server AND (in production) the built
// web client, served from one process on one port. See ARCHITECTURE.md §4.

import { createServer } from "http";
import { fileURLToPath } from "url";
import path from "path";
import express from "express";
import cors from "cors";
import colyseus from "colyseus";
import wsTransport from "@colyseus/ws-transport";
import { CobaRoom } from "./CobaRoom.js";

// CommonJS deps — default-import and destructure (see CobaRoom.ts).
const { Server } = colyseus;
const { WebSocketTransport } = wsTransport;

const PORT = Number(process.env.PORT ?? 2567);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "../dist");

const app = express();
app.use(cors()); // dev: client on :5173 reaches matchmaking on :2567
app.get("/health", (_req, res) => res.json({ ok: true }));

// Canonical host: 301 the apex (coba.games) → www.coba.games, preserving path +
// query. The prod app serves www, so this just collapses the bare domain onto
// it. Apex-specific, so coba-246.fly.dev and the staging host are untouched.
app.use((req, res, next) => {
  if (req.headers.host?.split(":")[0] === "coba.games") {
    res.redirect(301, `https://www.coba.games${req.url}`);
    return;
  }
  next();
});

// Serve the built client in production (dist/ exists after `vite build`).
// In dev the client is served by Vite and this is simply absent.
app.use(express.static(DIST));
app.get("*", (_req, res) => res.sendFile(path.join(DIST, "index.html")));

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
