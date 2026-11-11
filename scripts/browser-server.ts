import { spawn, type ChildProcess } from "node:child_process";
import { rm } from "node:fs/promises";
import path from "node:path";
import { createTestDatabase } from "../tests/api/db-harness";
import {
  BROWSER_TEST_PASSWORD,
  BROWSER_TEST_PORT,
  BROWSER_TEST_SECRET,
} from "../tests/browser/auth";
import {
  dropRecordedTestDatabase,
  forgetTestDatabase,
  readTestDatabaseState,
  recordTestDatabase,
} from "../tests/browser/test-database-state";

const hostname = "127.0.0.1";
const port = BROWSER_TEST_PORT;

let database: Awaited<ReturnType<typeof createTestDatabase>> | null = null;
let server: ChildProcess | null = null;
let shuttingDown = false;

async function stopServer() {
  const child = server;
  if (!child || child.exitCode !== null) return;

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 8_000);

    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function shutdown(exitCode: number) {
  if (shuttingDown) return;
  shuttingDown = true;

  await stopServer();
  if (database) {
    try {
      await database.dispose();
    } catch (error) {
      console.error("Could not remove the browser test database:", error);
    }
  }
  await forgetTestDatabase();
  process.exit(exitCode);
}

process.once("SIGTERM", () => void shutdown(0));
process.once("SIGINT", () => void shutdown(0));

async function main() {
  // A previous run may have been killed before its teardown could clean up.
  await dropRecordedTestDatabase();

  // The suite keeps its own credential file, so a password changed in the
  // developer's workspace never breaks its throwaway sign-in.
  const authCredentialPath = path.join(
    process.cwd(),
    "tests",
    ".browser-auth-credential.json",
  );
  await rm(authCredentialPath, { force: true });

  database = await createTestDatabase();
  await recordTestDatabase({
    databaseUrl: database.url,
    attachmentsDir: database.attachmentsDir,
  });

  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const env = {
    ...process.env,
    DATABASE_URL: database.url,
    ATTACHMENTS_DIR: database.attachmentsDir,
    NEXT_DIST_DIR: ".next-browser-test",
    NEXT_TELEMETRY_DISABLED: "1",
    // `next start` is a production server, and production fails closed without
    // sign-in configured. The suite signs in with these throwaway credentials.
    KBS_AUTH_PASSWORD: BROWSER_TEST_PASSWORD,
    KBS_AUTH_SECRET: BROWSER_TEST_SECRET,
    KBS_AUTH_CREDENTIAL_PATH: authCredentialPath,
  };

  server = spawn(process.execPath, [nextBin, "build"], {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });

  const buildExitCode = await new Promise<number | null>((resolve, reject) => {
    server?.once("error", reject);
    server?.once("exit", resolve);
  });
  server = null;

  if (shuttingDown) return;
  if (buildExitCode !== 0) {
    throw new Error(`Browser test build exited with code ${buildExitCode ?? "unknown"}.`);
  }

  server = spawn(
    process.execPath,
    [nextBin, "start", "--hostname", hostname, "--port", port],
    {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
    },
  );

  await recordTestDatabase({
    databaseUrl: database.url,
    attachmentsDir: database.attachmentsDir,
    serverPid: server.pid,
    port: Number(port),
  });

  server.once("error", (startError) => {
    console.error("Could not start the browser test server:", startError);
    void shutdown(1);
  });
  server.once("exit", (code) => {
    if (shuttingDown) return;

    void (async () => {
      // Playwright's teardown stops the server to drop the database, which
      // looks like a crash on Windows; let the teardown own the cleanup.
      const state = await readTestDatabaseState();
      if (state?.stopping) {
        shuttingDown = true;
        process.exit(0);
      }

      console.error(`Browser test server exited with code ${code ?? "unknown"}.`);
      await shutdown(code ?? 1);
    })();
  });
}

void main().catch(async (error) => {
  console.error("Could not prepare the browser test server:", error);
  await shutdown(1);
});
