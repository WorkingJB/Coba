// Better Auth instance — Step 3 (accounts). Email+password only for now; an
// account is required for ONLINE play, while bot play stays anonymous. See
// ARCHITECTURE.md §6.3. Persistence is Fly Managed Postgres (MPG), reached via
// the DATABASE_URL secret that `fly mpg attach` injected into the app.
//
// Better Auth accepts a node-postgres Pool directly and drives it through its
// built-in Kysely adapter — no ORM/schema wiring beyond this. Migrations live in
// server/migrate.ts (run in-container via `fly ssh`), NOT at boot.

import { betterAuth } from "better-auth";
// pg is CommonJS — default-import then destructure (same pattern as colyseus in
// CobaRoom.ts), because Node's ESM named-export lexer can't see CJS exports.
import pg from "pg";

const { Pool } = pg;

// One shared pool for the process. DATABASE_URL points at MPG's pgbouncer
// endpoint (transaction pooling); node-postgres uses unnamed prepared
// statements, which transaction pooling supports, so this is safe at runtime.
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const auth = betterAuth({
  database: pool,
  // Fall back to request-inferred origin when unset (handy in dev); on the
  // deployed apps BETTER_AUTH_URL pins the canonical host for cookie scoping.
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: { enabled: true },
  // The SPA and the auth API are same-origin in every deployed environment, but
  // list the real hosts explicitly so origin checks never depend on inference.
  trustedOrigins: [
    "https://test.coba.games",
    "https://www.coba.games",
    "https://coba.games",
    "https://coba-test.fly.dev",
    "https://coba-246.fly.dev",
  ],
});
