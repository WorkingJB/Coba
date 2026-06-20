# Deploy & Environments

Coba runs two Fly.io environments off this one repo. **All testing happens in the cloud on
staging — never locally** (see [`CLAUDE.md`](./CLAUDE.md) for the standing rule).

| Env | Fly app | URL | Config | Deploy |
| --- | --- | --- | --- | --- |
| **Staging / test** | `coba-test` | https://test.coba.games (`coba-test.fly.dev`) | `fly.staging.toml` | `fly deploy -c fly.staging.toml --ha=false` |
| **Production** | `coba-prod` | game https://app.coba.games · marketing https://www.coba.games (`coba-prod.fly.dev`) | `fly.toml` | `fly deploy --ha=false` |

`--ha=false` keeps it to a single machine — match rooms are in-memory, so both players must hit
the same instance (see ARCHITECTURE.md §4). Staging suspends when idle (cost); prod stays warm.

## Host-based routing (one app, two surfaces)

The prod app serves **two surfaces from one process**, chosen by the request's `Host`:

| Host | Serves | |
| --- | --- | --- |
| `app.coba.games` | the **game** SPA + Colyseus WS + `/api/auth/*` | |
| `www.coba.games` | the **coming-soon marketing** page + `POST /api/waitlist` | |
| `coba.games` (apex) | 301 → `www.coba.games` | |

Which hosts are "game" hosts is the **`APP_HOSTS` secret** (comma list); everything else falls
through to the marketing page (`server/index.ts`). Set per app:
- prod `coba-prod`: `APP_HOSTS="app.coba.games,coba-prod.fly.dev"`
- staging `coba-test`: `APP_HOSTS="test.coba.games,coba-test.fly.dev"` (so `test.coba.games` stays
  the game; test the marketing branch with a `Host:` override, e.g.
  `curl -H "Host: www.coba.games" https://coba-test.fly.dev/`, or add an optional
  `www-test.coba.games` cert+DNS).

Vite builds **both** pages (`vite.config.ts` multi-page input): `dist/index.html` (game) and
`dist/marketing.html` (marketing). Marketing source is `marketing.html` + `src/marketing/`.

## Preview waitlist + signup gating

`www.coba.games` captures preview signups; only **approved** emails can create a game account.

- `POST /api/waitlist {email}` → row in `preview_signups` (`approved=false`).
- Approve: `fly ssh console -a coba-prod -C "npm run approve -- someone@example.com"` (idempotent
  upsert → `approved=true`). Raw SQL: `UPDATE preview_signups SET approved=true, approved_at=now()
  WHERE lower(email)=lower('…');`
- Gate: Better Auth's `databaseHooks.user.create.before` (`server/auth.ts`) rejects signup for any
  email not approved (403) — authoritative, server-side. The `preview_signups` table is created by
  `npm run migrate` (see below).

## Workflow

1. Make changes on a branch.
2. **Deploy to staging:** `fly deploy -c fly.staging.toml --ha=false`
3. **Test on https://test.coba.games** — playtest, multiplayer, etc. This is the only test step.
4. When it's good, merge, then **deploy to prod:** `fly deploy --ha=false`

Local `node_modules` / `dist` are intentionally **not** kept — the Docker image builds them
in-container (`npm ci` + `vite build`), so deploys need neither. Restore them only if you ever
must work offline: `npm install`.

## Auth database (Fly Managed Postgres) & migrations

Better Auth (and the `preview_signups` waitlist table) persist to **Fly Managed Postgres**. Each
env has its **own** cluster, `fly mpg attach`ed to its app → injects the `DATABASE_URL` secret (a
private-network pgbouncer endpoint, **not** reachable from a laptop):
- Staging: `coba-test-db` (id `1zqyxr7l8n7owp8m`, iad) → `coba-test`.
- Production: `coba-prod-db` (id `w867508y2z7r3pk4`, iad, Basic plan) → `coba-prod`.

Also set per app: `BETTER_AUTH_SECRET` (`openssl rand -base64 32`), `BETTER_AUTH_URL`
(prod = `https://app.coba.games`), and `APP_HOSTS` (see host-routing above).

**Running schema migrations** (after adding auth tables/columns) — cloud-only, in-container:

```sh
# The 256 MB VM OOM-kills tsx+better-auth (exit 137), so bump memory first:
fly scale memory 1024 -a coba-test
curl -s https://test.coba.games/health   # wake the suspended machine
fly ssh console -a coba-test -C "npm run migrate"
fly scale memory 256 -a coba-test        # restore (next `fly deploy` re-pins 256 from fly.toml anyway)
```

`npm run migrate` runs `server/migrate.ts`, which uses better-auth's own `getMigrations()` (so the
migration logic always matches the installed runtime) and is idempotent. Prod uses the same flow
against its own MPG cluster + secrets.

## DNS (at the coba.games registrar)

Custom-domain certs are created on Fly (`fly certs add … -a <app>`). They stay "Awaiting
configuration" until these records exist. **`coba-prod` uses dedicated IPs**, so all three prod
hostnames point at the same pair (a dedicated IP also avoids SNI ambiguity while two apps exist):

| coba-prod dedicated | value |
| --- | --- |
| A (v4) | `137.66.50.236` |
| AAAA (v6) | `2a09:8280:1::12f:f55b:0` |

**Production (all → coba-prod):**
```
A     app   137.66.50.236     AAAA  app   2a09:8280:1::12f:f55b:0   # the game
A     www   137.66.50.236     AAAA  www   2a09:8280:1::12f:f55b:0   # marketing
A     @     137.66.50.236     AAAA  @     2a09:8280:1::12f:f55b:0   # apex → 301 www
```

**Staging — `test.coba.games`** (unchanged):
```
A     test    66.241.125.41
AAAA  test    2a09:8280:1::12f:5184:0
```

Then check issuance: `fly certs check app.coba.games` (and `www.coba.games`, `coba.games`).
Let's Encrypt validates automatically once DNS resolves (usually a few minutes).

Notes:
- The prod IPs are **dedicated** (`fly ips list -a coba-prod`); `test` uses Fly shared addresses.
- Apex `coba.games` → `www.coba.games` is a 301 app-level redirect in `server/index.ts` (keyed on
  the apex Host), not DNS — so the apex must point at the prod app and have its own cert.

### Migrating prod from the old `coba-246` app

Prod was previously the `coba-246` app serving the game on `www.coba.games`. We moved to a
correctly-named `coba-prod` (Fly can't rename apps) and split www→marketing / app→game. Cutover:
1. Provision `coba-prod` (done): app, dedicated IPs, `coba-prod-db` MPG, secrets, deploy, migrate,
   certs for `app`/`www`/`coba.games`. Verified on `coba-prod.fly.dev`.
2. **Repoint DNS** (above) so `app`/`www`/`@` → coba-prod's dedicated IPs.
3. `fly certs check` all three → Issued; verify `app` (game+gating), `www` (marketing), apex (301).
4. Only then decommission the old app: `fly certs remove www.coba.games -a coba-246`,
   `fly certs remove coba.games -a coba-246`, `fly apps destroy coba-246` (and `coba-246`'s MPG, if
   any was attached).
