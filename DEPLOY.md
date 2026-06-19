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

Then check issuance: `fly certs check test.coba.games` and `fly certs check www.coba.games`
(Let's Encrypt validates automatically once DNS resolves; usually a few minutes).

Notes:
- Subdomain CNAMEs (`test`/`www` → `coba-test.fly.dev` / `coba-246.fly.dev`) also work and
  auto-track IP changes; the A/AAAA above are Fly's recommended setup.
- The IPs above are Fly **shared** addresses (routing is by SNI/Host + the cert, so shared is
  fine). For a stable prod IP you can later allocate a dedicated one: `fly ips allocate-v4 -a coba-246`.
- Apex `coba.games` → `www` redirect is not set up yet (deferred; out of scope until needed).
