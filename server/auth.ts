// Better Auth instance — Step 3 (accounts). Email+password only for now; an
// account is required for ONLINE play, while bot play stays anonymous. See
// ARCHITECTURE.md §6.3. Persistence is Fly Managed Postgres (MPG), reached via
// the DATABASE_URL secret that `fly mpg attach` injected into the app.
//
// Better Auth accepts a node-postgres Pool directly and drives it through its
// built-in Kysely adapter — no ORM/schema wiring beyond this. Migrations live in
// server/migrate.ts (run in-container via `fly ssh`), NOT at boot.

import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { pool, isApprovedEmail } from "./db.js";

export const auth = betterAuth({
  database: pool,
  // Fall back to request-inferred origin when unset (handy in dev); on the
  // deployed apps BETTER_AUTH_URL pins the canonical host for cookie scoping.
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: { enabled: true },
  // The game SPA and the auth API are same-origin on app.coba.games; list the
  // real hosts explicitly so origin checks never depend on inference. (www is
  // the marketing site — no auth there — but it's kept for the staging mirror.)
  trustedOrigins: [
    "https://app.coba.games",
    "https://test.coba.games",
    "https://www.coba.games",
    "https://www-test.coba.games",
    "https://coba.games",
    "https://coba-prod.fly.dev",
    "https://coba-test.fly.dev",
  ],
  // Preview gating: signup is allowed ONLY for emails on the approved waitlist
  // (preview_signups). The before-hook runs inside the create transaction, so a
  // throw aborts account creation regardless of which client called — this is
  // the authoritative gate, not a client-side check.
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          if (!(await isApprovedEmail(user.email))) {
            throw new APIError("FORBIDDEN", {
              message:
                "This email isn't approved for the preview yet — join the waitlist at www.coba.games.",
            });
          }
          return { data: user };
        },
      },
    },
  },
});
