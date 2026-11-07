import { readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { Client } from "pg";

const STATE_FILE = path.join(process.cwd(), "tests", ".browser-test-database.json");

export type RecordedDatabase = {
  databaseUrl: string;
  attachmentsDir: string;
  serverPid?: number;
  port?: number;
  /** Set by the teardown before it stops the server, so the server process exits quietly. */
  stopping?: boolean;
};

/**
 * Records the temporary database so a later process can drop it. The browser
 * server process is force-killed on Windows, so cleanup cannot rely on its
 * signal handlers alone.
 */
export async function recordTestDatabase(database: RecordedDatabase) {
  await writeFile(STATE_FILE, JSON.stringify(database), "utf8");
}

export async function readTestDatabaseState(): Promise<RecordedDatabase | null> {
  const raw = await readFile(STATE_FILE, "utf8").catch(() => null);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as RecordedDatabase;
  } catch {
    return null;
  }
}

export async function forgetTestDatabase() {
  await rm(STATE_FILE, { force: true });
}

async function markRecordedServerStopping(recorded: RecordedDatabase) {
  await writeFile(STATE_FILE, JSON.stringify({ ...recorded, stopping: true }), "utf8");
}

function isPortOpen(port: number, timeoutMs = 500) {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    const finish = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function stopRecordedServer(recorded: RecordedDatabase) {
  const { serverPid, port } = recorded;
  if (!serverPid || !port) return;
  if (!(await isPortOpen(port))) return;

  await markRecordedServerStopping(recorded);

  try {
    process.kill(serverPid, "SIGTERM");
  } catch {
    return;
  }

  const timeoutAt = Date.now() + 8_000;
  while (Date.now() < timeoutAt && (await isPortOpen(port))) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (await isPortOpen(port, 2_000)) {
    try {
      process.kill(serverPid, "SIGKILL");
    } catch {
      // The server exited between the check and the signal.
    }
  }
}

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
}

/**
 * Stops the recorded server, then drops the database and its attachments
 * directory. Safe to call when no state file exists or when the database is
 * already gone.
 */
export async function dropRecordedTestDatabase() {
  const recorded = await readTestDatabaseState();
  if (!recorded) {
    await forgetTestDatabase();
    return;
  }

  const databaseName = new URL(recorded.databaseUrl).pathname.slice(1);
  if (!databaseName.startsWith("kbs_api_test_")) {
    throw new Error(`Refusing to drop unexpected database "${databaseName}".`);
  }

  await stopRecordedServer(recorded);

  const adminUrl = new URL(recorded.databaseUrl);
  adminUrl.pathname = "/postgres";
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();

  try {
    await waitForConnectionsToClose(admin, databaseName);
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [databaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  } finally {
    await admin.end();
    await rm(recorded.attachmentsDir, { recursive: true, force: true });
    await forgetTestDatabase();
  }
}
