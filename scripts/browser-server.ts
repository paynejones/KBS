import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
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
const distDir = ".next-browser-test";
// Build entries that the standalone server does not need, or already has.
const SKIPPED_BUILD_ENTRIES = new Set([
  "standalone",
  "node_modules",
  "cache",
  "diagnostics",
  "build",
  "dev",
]);

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
    NEXT_DIST_DIR: distDir,
    NEXT_TELEMETRY_DISABLED: "1",
    // Resolves the root-layout failure probe in the browser-test build only.
    KBS_BROWSER_TEST: "1",
    // The standalone server runs in production mode, which fails closed
    // without sign-in configured. The suite signs in with these throwaway
    // credentials.
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

  // `next start` cannot serve a standalone build, so run the generated server
  // exactly as the deployment image does. With a custom dist directory Next
  // leaves the build outside the server directory while the generated config
  // still points at the dist directory name, so stage the build where the
  // server looks for it. The image likewise copies in the static assets and
  // public directory.
  const standaloneDir = path.join(process.cwd(), distDir, "standalone");
  const standaloneDist = path.join(standaloneDir, distDir);
  const buildDir = path.join(process.cwd(), distDir);
  await rm(standaloneDist, { recursive: true, force: true });
  await mkdir(standaloneDist, { recursive: true });
  for (const entry of await readdir(buildDir)) {
    if (SKIPPED_BUILD_ENTRIES.has(entry)) continue;
    await cp(path.join(buildDir, entry), path.join(standaloneDist, entry), {
      recursive: true,
    });
  }
  await cp(
    path.join(process.cwd(), "public"),
    path.join(standaloneDir, "public"),
    { recursive: true },
  ).catch(() => {
    // The app may have no public directory; nothing else needs copying.
  });

  server = spawn(
    process.execPath,
    [path.join(standaloneDir, "server.js")],
    {
      cwd: process.cwd(),
      env: { ...env, PORT: port, HOSTNAME: hostname },
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
