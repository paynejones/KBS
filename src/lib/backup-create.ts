import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { attachmentsDirectory } from "@/lib/attachment-paths";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupIdFromDate,
  backupsDirectory,
  checksum,
  directoryExists,
  verifyBackupDirectory,
  writeBackupManifest,
  type BackupAttachmentEntry,
  type BackupManifest,
} from "@/lib/backup";
import { buildWorkspaceExport } from "@/lib/workspace-export";

function isMissingFile(error: unknown) {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * Writes a dated backup folder containing workspace.json, a copy of every
 * attachment, and a manifest of row counts and checksums, then runs the restore
 * check on the result. Missing attachment files are recorded rather than
 * allowed to abort the whole backup.
 */
export async function createBackup(now = new Date()) {
  const workspace = await buildWorkspaceExport(now);
  const root = backupsDirectory();
  await mkdir(root, { recursive: true });

  const baseId = backupIdFromDate(now);
  let id = baseId;
  let directory = path.join(root, id);
  for (let suffix = 2; await directoryExists(directory); suffix += 1) {
    id = `${baseId}-${suffix}`;
    directory = path.join(root, id);
  }

  const filesDirectory = path.join(directory, "attachments");
  await mkdir(filesDirectory, { recursive: true });

  const entries: BackupAttachmentEntry[] = [];
  const missingAttachments: string[] = [];
  for (const attachment of workspace.attachments) {
    try {
      const bytes = await readFile(path.join(attachmentsDirectory(), attachment.id));
      await writeFile(path.join(filesDirectory, attachment.id), bytes);
      entries.push({
        id: attachment.id,
        size: bytes.byteLength,
        sha256: checksum(bytes),
      });
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      missingAttachments.push(attachment.id);
    }
  }

  await writeFile(
    path.join(directory, "workspace.json"),
    `${JSON.stringify(workspace, null, 2)}\n`,
    "utf8",
  );

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    id,
    createdAt: now.toISOString(),
    workspaceExport: "workspace.json",
    counts: workspace.counts,
    attachments: entries,
    missingAttachments,
    totals: {
      attachments: entries.length,
      bytes: entries.reduce((total, entry) => total + entry.size, 0),
    },
  };
  await writeBackupManifest(directory, manifest);

  const verification = await verifyBackupDirectory(directory);
  const verifiedManifest: BackupManifest = { ...manifest, verification };
  await writeBackupManifest(directory, verifiedManifest);

  return { manifest: verifiedManifest, verification, directory };
}
