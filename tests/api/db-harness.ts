import "dotenv/config";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";

export type TestDatabase = {
  url: string;
  attachmentsDir: string;
  dispose: (applicationPool?: Pool) => Promise<void>;
};

async function waitForConnectionsToClose(admin: Client, databaseName: string) {
  const timeoutAt = Date.now() + 10_000;

  while (Date.now() < timeoutAt) {
    const result = await admin.query<{ connections: string }>(
      "SELECT count(*)::text AS connections FROM pg_stat_activity WHERE datname = $1",
      [databaseName],
    );
    if (Number(result.rows[0]?.connections ?? 0) === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Timed out waiting for connections to ${databaseName} to close.`);
}

/**
 * Creates a uniquely named database from DATABASE_URL, applies the project
 * migrations there, and exposes a temporary attachments directory. Nothing
 * touches the configured application database.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const configuredUrl = process.env.DATABASE_URL;
  if (!configuredUrl) {
    throw new Error("DATABASE_URL is required to run the API tests.");
  }

  const databaseName = `kbs_api_test_${process.pid}_${Date.now()}`;
  const adminUrl = new URL(configuredUrl);
  adminUrl.pathname = "/postgres";
  const testUrl = new URL(configuredUrl);
  testUrl.pathname = `/${databaseName}`;

  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();

  let databaseCreated = false;
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    databaseCreated = true;

    const migrationPool = new Pool({ connectionString: testUrl.toString() });
    try {
      await migrate(drizzle({ client: migrationPool }), {
        migrationsFolder: path.resolve(process.cwd(), "drizzle"),
      });
    } finally {
      await migrationPool.end();
    }

    const attachmentsDir = await mkdtemp(path.join(process.cwd(), "tests", ".tmp-attachments-"));

    return {
      url: testUrl.toString(),
      attachmentsDir,
      async dispose(applicationPool?: Pool) {
        if (applicationPool) await applicationPool.end();
        try {
          await waitForConnectionsToClose(admin, databaseName);
          await admin.query(`DROP DATABASE "${databaseName}"`);
        } finally {
          await admin.end();
          await rm(attachmentsDir, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    // Never leave a temporary database or an open admin socket behind.
    if (databaseCreated) {
      await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`).catch(() => undefined);
    }
    await admin.end().catch(() => undefined);
    throw error;
  }
}
