# Deploy & Environments

Coba runs two Fly.io environments off this one repo. **All testing happens in the cloud on
staging — never locally** (see [`CLAUDE.md`](./CLAUDE.md) for the standing rule).

| Env | Fly app | URL | Config | Deploy |
| --- | --- | --- | --- | --- |
| **Staging / test** | `coba-test` | https://test.coba.games (`coba-test.fly.dev`) | `fly.staging.toml` | `fly deploy -c fly.staging.toml --ha=false` |
| **Production** | `coba-246` | https://www.coba.games (`coba-246.fly.dev`) | `fly.toml` | `fly deploy --ha=false` |

`--ha=false` keeps it to a single machine — match rooms are in-memory, so both players must hit
the same instance (see ARCHITECTURE.md §4). Staging suspends when idle (cost); prod stays warm.

## Workflow

1. Make changes on a branch.
2. **Deploy to staging:** `fly deploy -c fly.staging.toml --ha=false`
3. **Test on https://test.coba.games** — playtest, multiplayer, etc. This is the only test step.
4. When it's good, merge, then **deploy to prod:** `fly deploy --ha=false`

Local `node_modules` / `dist` are intentionally **not** kept — the Docker image builds them
in-container (`npm ci` + `vite build`), so deploys need neither. Restore them only if you ever
must work offline: `npm install`.

## Auth database (Fly Managed Postgres) & migrations

Better Auth persists to **Fly Managed Postgres**. Staging cluster: `coba-test-db`
(id `1zqyxr7l8n7owp8m`, region `iad`), `fly mpg attach`ed to `coba-test` → injects the
`DATABASE_URL` secret (a private-network pgbouncer endpoint, **not** reachable from a laptop).
Also set per app: `BETTER_AUTH_SECRET` (`openssl rand -base64 32`) and `BETTER_AUTH_URL`.

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

## DNS (one-time, at the coba.games registrar)

Custom-domain certs are already created on Fly (`fly certs add ...`). They stay "Awaiting
configuration" until these records exist. Add them at your DNS provider:

**Staging — `test.coba.games`:**
```
A     test    66.241.125.41
AAAA  test    2a09:8280:1::12f:5184:0
```

**Production — `www.coba.games`:**
```
A     www     66.241.124.199
AAAA  www     2a09:8280:1::12f:1c2d:0
```

**Apex — `coba.games`** (redirects to www; see below):
```
A     @       66.241.124.199
AAAA  @       2a09:8280:1::12f:1c2d:0
```

Then check issuance: `fly certs check test.coba.games` and `fly certs check www.coba.games`
(Let's Encrypt validates automatically once DNS resolves; usually a few minutes).

Notes:
- Subdomain CNAMEs (`test`/`www` → `coba-test.fly.dev` / `coba-246.fly.dev`) also work and
  auto-track IP changes; the A/AAAA above are Fly's recommended setup.
- The IPs above are Fly **shared** addresses (routing is by SNI/Host + the cert, so shared is
  fine). For a stable prod IP you can later allocate a dedicated one: `fly ips allocate-v4 -a coba-246`.
- Apex `coba.games` → `www.coba.games` redirect **is set up** (301, path + query preserved). It's
  an app-level redirect in `server/index.ts` (keyed on the `coba.games` Host), not DNS — so the
  apex must point A/AAAA at the prod app (records above) and have its own cert (`fly certs add
  coba.games -a coba-246`, already done) for the HTTPS redirect to fire.
