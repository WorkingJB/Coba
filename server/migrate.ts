// Better Auth schema migration runner. Run this IN THE CLOUD (cloud-only rule),
// inside the staging/prod container where DATABASE_URL is set:
//
//   fly ssh console -a coba-test -C "npx tsx server/migrate.ts"
//
// We use better-auth's own getMigrations() rather than the separately-versioned
// @better-auth/cli so the migration logic always matches the installed runtime.
// It's idempotent: it only creates tables/columns that are missing, so re-running
// after a deploy is safe and is the intended way to apply schema changes.

import { getMigrations } from "better-auth/db/migration";
import { auth } from "./auth.js";
import { pool } from "./db.js";

const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);

const tables = [...toBeCreated, ...toBeAdded].map((t) => t.table);
if (tables.length === 0) {
  console.log("Better Auth schema already up to date — nothing to migrate.");
} else {
  console.log(`Applying Better Auth migrations for: ${tables.join(", ")}`);
  await runMigrations();
  console.log("Better Auth migrations applied.");
}

// Preview waitlist table (not part of Better Auth's schema, so migrate it here).
// Idempotent — safe to re-run after every deploy, same as the auth migrations.
await pool.query(`
  CREATE TABLE IF NOT EXISTS preview_signups (
    id          bigserial PRIMARY KEY,
    email       text UNIQUE NOT NULL,
    approved    boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    approved_at timestamptz
  )
`);
console.log("preview_signups table ready.");

process.exit(0);
