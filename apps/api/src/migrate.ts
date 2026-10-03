import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
export async function migrate(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(71932001)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const name of (await readdir("db/migrations"))
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      if (
        (
          await client.query(
            "SELECT 1 FROM schema_migrations WHERE name = $1",
            [name],
          )
        ).rowCount
      )
        continue;
      await client.query(
        await readFile(resolve("db/migrations", name), "utf8"),
      );
      await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [
        name,
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await migrate(pool);
  } finally {
    await pool.end();
  }
}
