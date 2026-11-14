import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not configured");
}

/**
 * One long-lived Next.js server shares a single pool, so every limit here is
 * about keeping a stalled database from stalling the process:
 *
 * - `connectionTimeoutMillis` fails a request that cannot get a client instead
 *   of leaving it pending forever while the database is unreachable.
 * - `statement_timeout` cancels a query the server has stopped making progress
 *   on. It stays generous because an export or backup reads every row in one
 *   statement on a large workspace; raise it there rather than removing it.
 * - `idleTimeoutMillis` lets the pool give connections back when the app is
 *   quiet, which matters on a host with a small connection allowance.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
  statement_timeout: 60_000,
});

/**
 * A connection that fails while it is idle — a database restart, a managed
 * failover, or a dropped socket — is reported here. Without a listener Node
 * treats the emitted error as unhandled and terminates the process, so an
 * otherwise recoverable outage would take the whole server down. Log it in the
 * same one-line JSON shape as the API error log and keep serving: the pool
 * discards the dead client and the next query opens a fresh connection.
 */
pool.on("error", (error) => {
  console.error(
    JSON.stringify({
      level: "error",
      time: new Date().toISOString(),
      message: "Idle database client failed",
      error: { name: error.name, message: error.message, stack: error.stack },
    }),
  );
});

export const db = drizzle({ client: pool });