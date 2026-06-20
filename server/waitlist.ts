// List the preview waitlist (cloud-only, run inside the container where
// DATABASE_URL is set — same pattern as migrate.ts / approve.ts):
//
//   fly ssh console -a coba-prod -C "npm run waitlist"
//
// Shows every signup, approved first. Approve one with `npm run approve -- <email>`.

import { pool } from "./db.js";

const { rows } = await pool.query<{
  email: string;
  approved: boolean;
  created_at: Date;
  approved_at: Date | null;
}>(
  `SELECT email, approved, created_at, approved_at
   FROM preview_signups
   ORDER BY approved DESC, created_at ASC`,
);

if (rows.length === 0) {
  console.log("No preview signups yet.");
} else {
  const approved = rows.filter((r) => r.approved).length;
  console.log(`${rows.length} signup(s) — ${approved} approved, ${rows.length - approved} pending:\n`);
  for (const r of rows) {
    const mark = r.approved ? "✓ approved" : "· pending ";
    console.log(`  ${mark}  ${r.email}`);
  }
}

process.exit(0);
