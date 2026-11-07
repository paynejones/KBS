import "dotenv/config";
import { rm } from "node:fs/promises";
import path from "node:path";
import {
  backupDirectory,
  listBackups,
  verifyBackupDirectory,
} from "../src/lib/backup";
import { createBackup } from "../src/lib/backup-create";

/**
 * Creates a full workspace backup (database export plus attachment files) and
 * runs the restore check. Intended for cron, systemd timers, or Windows Task
 * Scheduler.
 *
 *   npm run backup
 *   npm run backup -- --keep 14
 *   npm run backup -- --verify data/backups/2026-11-07T22-21-03-123Z
 */

function argumentValue(name: string) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;

  return process.argv[index + 1] ?? null;
}

async function main() {
  const verifyTarget = argumentValue("--verify");

  if (verifyTarget) {
    const directory = path.resolve(verifyTarget);
    const verification = await verifyBackupDirectory(directory);

    if (verification.ok) {
      console.log(
        `Backup verified: ${verification.files} attachment file(s) match the manifest and workspace.json is complete.`,
      );

      return;
    }

    console.error("Backup check failed:");
    for (const error of verification.errors) console.error(` - ${error}`);
    process.exitCode = 1;

    return;
  }

  const { manifest, verification, directory } = await createBackup();
  console.log(`Backup ${manifest.id} written to ${directory}`);
  console.log(
    `  ${manifest.totals.attachments} attachment file(s), ${manifest.totals.bytes} byte(s), ${manifest.counts.pages ?? 0} page(s).`,
  );

  if (!verification.ok) {
    console.error("Backup check failed:");
    for (const error of verification.errors) console.error(` - ${error}`);
    process.exitCode = 1;

    return;
  }

  console.log("Backup check passed: workspace.json and every attachment match the manifest.");

  const keep = Number(argumentValue("--keep") ?? "0");
  if (Number.isFinite(keep) && keep > 0) {
    const backups = await listBackups();
    for (const old of backups.slice(keep)) {
      await rm(backupDirectory(old.id), { recursive: true, force: true });
      console.log(`Removed older backup ${old.id}.`);
    }
  }
}

main().catch((error) => {
  console.error("Backup failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
