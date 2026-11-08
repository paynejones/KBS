import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceExport } from "@/lib/workspace-export";

export const BACKUP_FORMAT = "kbs-backup";
export const BACKUP_VERSION = 1;

/** Collections a restorable workspace export must contain. */
export const EXPORT_COLLECTIONS = [
  "pages",
  "pageRevisions",
  "tags",
  "pageTags",
  "pageLinks",
  "databases",
  "databaseProperties",
  "databaseViews",
  "databaseRecords",
  "databaseTemplates",
  "pageTemplates",
  "databaseRecordRelations",
  "attachments",
] as const;

export type BackupAttachmentEntry = {
  id: string;
  size: number;
  sha256: string;
};

export type BackupVerification = {
  checkedAt: string;
  ok: boolean;
  files: number;
  missingFiles: string[];
  errors: string[];
};

export type BackupManifest = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  id: string;
  createdAt: string;
  workspaceExport: "workspace.json";
  counts: Record<string, number>;
  attachments: BackupAttachmentEntry[];
  missingAttachments: string[];
  totals: { attachments: number; bytes: number };
  verification?: BackupVerification;
};

export type BackupSummary = {
  id: string;
  createdAt: string;
  attachments: number;
  bytes: number;
  missingAttachments: number;
  verified: boolean;
  errors: string[];
};

export function backupsDirectory() {
  return process.env.BACKUPS_DIR || path.join(process.cwd(), "data", "backups");
}

export function backupIdFromDate(date: Date) {
  // Colons and dots are illegal in Windows file names, so the ISO timestamp is
  // flattened into something sortable and portable.
  return date.toISOString().replace(/[:.]/g, "-");
}

export function isValidBackupId(id: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(-\d+)?$/.test(id);
}

export function backupDirectory(id: string) {
  if (!isValidBackupId(id)) throw new Error("Invalid backup ID.");

  return path.join(/*turbopackIgnore: true*/ backupsDirectory(), id);
}

export function checksum(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isMissingFile(error: unknown) {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export async function directoryExists(target: string) {
  try {
    await readdir(target);

    return true;
  } catch {
    return false;
  }
}

export async function readBackupManifest(directory: string): Promise<BackupManifest> {
  return JSON.parse(
    await readFile(path.join(directory, "manifest.json"), "utf8"),
  ) as BackupManifest;
}

export async function writeBackupManifest(
  directory: string,
  manifest: BackupManifest,
) {
  await writeFile(
    path.join(directory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

/**
 * The restore check. It proves the backup is self-describing and intact: the
 * manifest parses, workspace.json is a version 1 export with every expected
 * collection and matching row counts, and every recorded attachment exists with
 * the size and checksum captured at backup time.
 */
export async function verifyBackupDirectory(
  directory: string,
): Promise<BackupVerification> {
  const errors: string[] = [];
  const missingFiles: string[] = [];
  let files = 0;

  const finish = (): BackupVerification => ({
    checkedAt: new Date().toISOString(),
    ok: errors.length === 0,
    files,
    missingFiles,
    errors: errors.slice(0, 20),
  });

  let manifest: BackupManifest;
  try {
    manifest = await readBackupManifest(directory);
  } catch {
    errors.push("manifest.json is missing or unreadable.");

    return finish();
  }

  if (manifest.format !== BACKUP_FORMAT || manifest.version !== BACKUP_VERSION) {
    errors.push("manifest.json is not a version 1 KBS backup.");
  }

  let workspace: WorkspaceExport | null = null;
  try {
    workspace = JSON.parse(
      await readFile(path.join(directory, "workspace.json"), "utf8"),
    ) as WorkspaceExport;
  } catch {
    errors.push("workspace.json is missing or unreadable.");
  }

  if (workspace) {
    if (workspace.format !== "kbs-export" || workspace.version !== 1) {
      errors.push("workspace.json is not a version 1 KBS export.");
    }

    const collections = workspace as unknown as Record<string, unknown>;
    for (const key of EXPORT_COLLECTIONS) {
      const rows = collections[key];
      if (!Array.isArray(rows)) {
        errors.push(`workspace.json is missing the ${key} collection.`);
        continue;
      }
      const expected = manifest.counts?.[key];
      if (typeof expected === "number" && expected !== rows.length) {
        errors.push(`${key}: expected ${expected} row(s), found ${rows.length}.`);
      }
    }

    const ledger = new Set([
      ...(manifest.attachments ?? []).map((entry) => entry.id),
      ...(manifest.missingAttachments ?? []),
    ]);
    const unrecorded = (
      Array.isArray(workspace.attachments) ? workspace.attachments : []
    ).filter((attachment) => !ledger.has(attachment.id));
    if (unrecorded.length > 0) {
      errors.push(
        `${unrecorded.length} attachment(s) in workspace.json have no manifest entry.`,
      );
    }
  }

  for (const entry of manifest.attachments ?? []) {
    files += 1;
    try {
      const bytes = await readFile(path.join(directory, "attachments", entry.id));
      if (bytes.byteLength !== entry.size) {
        errors.push(
          `Attachment ${entry.id} is ${bytes.byteLength} byte(s), expected ${entry.size}.`,
        );
      } else if (checksum(bytes) !== entry.sha256) {
        errors.push(`Attachment ${entry.id} does not match its recorded checksum.`);
      }
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      missingFiles.push(entry.id);
    }
  }

  if (missingFiles.length > 0) {
    errors.push(`${missingFiles.length} attachment file(s) are missing from the backup.`);
  }

  return finish();
}

export function summarizeBackup(manifest: BackupManifest): BackupSummary {
  return {
    id: manifest.id,
    createdAt: manifest.createdAt,
    attachments: manifest.totals?.attachments ?? manifest.attachments?.length ?? 0,
    bytes: manifest.totals?.bytes ?? 0,
    missingAttachments: manifest.missingAttachments?.length ?? 0,
    verified: manifest.verification?.ok === true,
    errors: manifest.verification?.errors ?? [],
  };
}

export async function listBackups(): Promise<BackupSummary[]> {
  let entries: string[];
  try {
    entries = await readdir(/*turbopackIgnore: true*/ backupsDirectory());
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }

  const summaries: BackupSummary[] = [];
  for (const entry of entries) {
    if (!isValidBackupId(entry)) continue;
    try {
      summaries.push(
        summarizeBackup(
          await readBackupManifest(
            path.join(/*turbopackIgnore: true*/ backupsDirectory(), entry),
          ),
        ),
      );
    } catch {
      // An unreadable manifest is not a usable backup, but it should not hide
      // the ones that are intact.
    }
  }

  return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function verifyStoredBackup(id: string) {
  const directory = backupDirectory(id);
  const manifest = await readBackupManifest(directory);
  const verification = await verifyBackupDirectory(directory);
  const updated: BackupManifest = { ...manifest, verification };
  await writeBackupManifest(directory, updated);

  return { manifest: updated, verification };
}
