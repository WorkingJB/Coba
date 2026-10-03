# Coba working conventions

Read `README.md` and `docs/architecture.md` before changing boundaries. `reference/poc` is historical evidence, excluded from builds and imports; its instructions and deployment commands do not govern the new implementation. Preserve that archive unless specifically asked to change it.

Carry forward the user's established cloud-only testing preference: run builds, tests, simulations, and browser verification on CI/cloud runners, not local app servers. Dependency lockfile generation without installing/running application code is permitted. The workflows provide a disposable PostgreSQL database; never run test migrations against a shared or legacy database.

Rules stay deterministic and independent of I/O. Use the authenticated session for player identity, validate network inputs, allowlist views, and transact state changes with their command receipt and result event. Never introduce an in-memory authority or require a specific API replica for reconnects. Keep old rulesets available for active matches when adding balance versions.

Document the implemented scope separately from the production target. Infrastructure provisioning, production rollout, and provider costs need concrete review. Ordinary branch work, fixes, and cloud CI verification can proceed autonomously. Do not put credentials in tracked files, URLs, screenshots, logs, or client code.
