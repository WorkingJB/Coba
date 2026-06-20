// One shared node-postgres Pool for the whole server process. Used by Better
// Auth (server/auth.ts, via its Kysely adapter), the waitlist endpoint
// (server/index.ts), and the migrate/approve scripts. DATABASE_URL points at
// Fly Managed Postgres' pgbouncer endpoint (transaction pooling); node-postgres
// uses unnamed prepared statements, which transaction pooling supports.
//
// pg is CommonJS — default-import then destructure (same pattern as colyseus in
// CobaRoom.ts), because Node's ESM named-export lexer can't see CJS exports.
import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * True when `email` is on the preview allowlist and approved. Case-insensitive.
 * Used to gate Better Auth signup (server/auth.ts) to approved players only.
 */
export async function isApprovedEmail(email: string): Promise<boolean> {
  const { rows } = await pool.query(
    "SELECT 1 FROM preview_signups WHERE lower(email) = lower($1) AND approved = true LIMIT 1",
    [email],
  );
  return rows.length > 0;
}
