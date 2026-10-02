import pg from "pg";
import { buildApp } from "./app.js";
const { DATABASE_URL, APP_ORIGIN, PLAYTEST_ACCESS_KEY } = process.env;
if (
  !DATABASE_URL ||
  !APP_ORIGIN ||
  !PLAYTEST_ACCESS_KEY ||
  PLAYTEST_ACCESS_KEY.length < 16
)
  throw new Error(
    "DATABASE_URL, APP_ORIGIN and a PLAYTEST_ACCESS_KEY of at least 16 characters are required.",
  );
const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 3000,
  statement_timeout: 5000,
  idle_in_transaction_session_timeout: 10000,
});
const { app, store } = await buildApp({
  pool,
  origin: APP_ORIGIN,
  accessKey: PLAYTEST_ACCESS_KEY,
  secureCookies: process.env.NODE_ENV === "production",
  serveWeb: true,
  logger: true,
});
let ticking = false;
const timer = setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try {
    await store.tick();
  } catch (err) {
    app.log.error({ err }, "Deadline sweep failed");
  } finally {
    ticking = false;
  }
}, 1000);
timer.unref();
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(timer);
  await app.close();
  await pool.end();
}
process.once("SIGTERM", () => {
  void shutdown();
});
process.once("SIGINT", () => {
  void shutdown();
});
await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 8080) });
