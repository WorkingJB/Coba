// Approve a preview waitlist email (cloud-only, run inside the container where
// DATABASE_URL is set — same pattern as migrate.ts):
//
//   fly ssh console -a coba-prod -C "npm run approve -- someone@example.com"
//
// Upserts the email as approved, so it works whether or not they used the
// waitlist form first (lets you pre-approve a known address). Once approved,
// that email can create an account at app.coba.games (gate in server/auth.ts).
// Raw-SQL alternative:
//   UPDATE preview_signups SET approved=true, approved_at=now() WHERE lower(email)=lower('...');

import { pool } from "./db.js";

const email = process.argv[2]?.trim();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: npm run approve -- <email>");
  process.exit(1);
}

const { rows } = await pool.query(
  `INSERT INTO preview_signups (email, approved, approved_at)
   VALUES ($1, true, now())
   ON CONFLICT (email) DO UPDATE SET approved = true, approved_at = now()
   RETURNING email`,
  [email],
);

console.log(`Approved for preview: ${rows[0].email}`);
process.exit(0);
