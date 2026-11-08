import { spawn } from "node:child_process";
import path from "node:path";

const TRACING_WARNING =
  "Dynamic filesystem access causes tracing of the whole project";
const WARNING_MESSAGE =
  "Turbopack traced the whole project through dynamic filesystem access. Scope the path or annotate intentional external storage with turbopackIgnore.";

async function main() {
  const nextBin = path.join(
    process.cwd(),
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );
  const build = spawn(process.execPath, [nextBin, "build"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED ?? "1",
    },
    stdio: ["inherit", "pipe", "pipe"],
  });

  let output = "";
  build.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
    process.stdout.write(chunk);
  });
  build.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
    process.stderr.write(chunk);
  });

  const exitCode = await new Promise<number>((resolve, reject) => {
    build.once("error", reject);
    build.once("close", (code, signal) => {
      if (signal) {
        console.error(`Build stopped by signal ${signal}.`);
        resolve(1);
        return;
      }

      resolve(code ?? 1);
    });
  });

  if (exitCode !== 0) {
    process.exitCode = exitCode;
    return;
  }

  if (!output.includes(TRACING_WARNING)) return;

  const warning = output
    .split(/\r?\n/)
    .find((line) => line.includes(TRACING_WARNING))
    ?.trim();

  console.error(
    process.env.GITHUB_ACTIONS
      ? `::error::${WARNING_MESSAGE}`
      : `Error: ${WARNING_MESSAGE}`,
  );
  if (warning) console.error(warning);
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(
    "Could not run the production build:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
