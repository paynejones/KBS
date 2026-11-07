import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  EXPORT_COLLECTIONS,
  backupIdFromDate,
  isValidBackupId,
  summarizeBackup,
  verifyBackupDirectory,
  type BackupManifest,
} from "../src/lib/backup";

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

type WorkspaceFixture = {
  format: string;
  version: number;
  exportedAt: string;
  counts: Record<string, number>;
  attachments: { id: string; filename: string; mimeType: string; size: number; url: string }[];
  attachmentsNote: string;
  [key: string]: unknown;
};

function workspaceWith(
  attachments: WorkspaceFixture["attachments"] = [],
  overrides: Partial<WorkspaceFixture> = {},
): WorkspaceFixture {
  const workspace: WorkspaceFixture = {
    format: "kbs-export",
    version: 1,
    exportedAt: "2026-11-07T00:00:00.000Z",
    counts: Object.fromEntries(EXPORT_COLLECTIONS.map((key) => [key, 0])),
    attachments,
    attachmentsNote: "note",
    ...overrides,
  };
  for (const key of EXPORT_COLLECTIONS) {
    if (!Array.isArray(workspace[key])) workspace[key] = [];
  }
  workspace.counts.attachments = attachments.length;

  return workspace;
}

async function makeBackup({
  files = [],
  workspace = workspaceWith(),
  manifest = {},
}: {
  files?: { id: string; bytes: Buffer }[];
  workspace?: WorkspaceFixture;
  manifest?: Record<string, unknown>;
} = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "kbs-backup-"));
  await mkdir(path.join(directory, "attachments"), { recursive: true });

  const entries = files.map((file) => ({
    id: file.id,
    size: file.bytes.byteLength,
    sha256: sha256(file.bytes),
  }));
  for (const file of files) {
    await writeFile(path.join(directory, "attachments", file.id), file.bytes);
  }

  const base: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    id: "2026-11-07T00-00-00-000Z",
    createdAt: "2026-11-07T00:00:00.000Z",
    workspaceExport: "workspace.json",
    counts: workspace.counts,
    attachments: entries,
    missingAttachments: [],
    totals: {
      attachments: entries.length,
      bytes: entries.reduce((total, entry) => total + entry.size, 0),
    },
  };
  const stored = { ...base, ...manifest };

  await writeFile(path.join(directory, "workspace.json"), JSON.stringify(workspace));
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify(stored));

  return {
    directory,
    manifest: stored as BackupManifest,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

function attachmentMetadata(id: string, size: number) {
  return {
    id,
    filename: "note.png",
    mimeType: "image/png",
    size,
    url: `/api/attachments/${id}`,
  };
}

test("backup ids are portable and reject traversal", () => {
  const id = backupIdFromDate(new Date("2026-11-07T22:21:03.123Z"));

  assert.equal(id, "2026-11-07T22-21-03-123Z");
  assert.equal(isValidBackupId(id), true);
  assert.equal(isValidBackupId(`${id}-2`), true);
  assert.equal(isValidBackupId("../2026-11-07T22-21-03-123Z"), false);
  assert.equal(isValidBackupId("2026-11-07T22-21-03-123Z/../../etc"), false);
  assert.equal(isValidBackupId("latest"), false);
  assert.equal(isValidBackupId(""), false);
});

test("a complete backup passes the restore check", async () => {
  const bytes = Buffer.from("image-bytes");
  const id = "11111111-1111-1111-1111-111111111111";
  const backup = await makeBackup({
    files: [{ id, bytes }],
    workspace: workspaceWith([attachmentMetadata(id, bytes.byteLength)]),
  });

  try {
    const verification = await verifyBackupDirectory(backup.directory);

    assert.equal(verification.ok, true, verification.errors.join("; "));
    assert.equal(verification.files, 1);
    assert.deepEqual(verification.missingFiles, []);
  } finally {
    await backup.cleanup();
  }
});

test("the restore check reports a missing attachment file", async () => {
  const id = "22222222-2222-2222-2222-222222222222";
  const bytes = Buffer.from("gone");
  const backup = await makeBackup({
    workspace: workspaceWith([attachmentMetadata(id, bytes.byteLength)]),
    manifest: {
      attachments: [{ id, size: bytes.byteLength, sha256: sha256(bytes) }],
      totals: { attachments: 1, bytes: bytes.byteLength },
    },
  });

  try {
    const verification = await verifyBackupDirectory(backup.directory);

    assert.equal(verification.ok, false);
    assert.deepEqual(verification.missingFiles, [id]);
    assert.match(verification.errors.join("\n"), /missing from the backup/);
  } finally {
    await backup.cleanup();
  }
});

test("the restore check catches a corrupted attachment of the same size", async () => {
  const id = "33333333-3333-3333-3333-333333333333";
  const original = Buffer.from("good");
  const corrupted = Buffer.from("evil");
  const backup = await makeBackup({
    files: [{ id, bytes: corrupted }],
    workspace: workspaceWith([attachmentMetadata(id, original.byteLength)]),
    manifest: {
      attachments: [{ id, size: original.byteLength, sha256: sha256(original) }],
      totals: { attachments: 1, bytes: original.byteLength },
    },
  });

  try {
    const verification = await verifyBackupDirectory(backup.directory);

    assert.equal(verification.ok, false);
    assert.match(verification.errors.join("\n"), /does not match its recorded checksum/);
  } finally {
    await backup.cleanup();
  }
});

test("the restore check compares recorded row counts with the export", async () => {
  const workspace = workspaceWith([], {
    pages: [{ id: "a" }, { id: "b" }],
    counts: { pages: 1 },
  });
  const backup = await makeBackup({ workspace });

  try {
    const verification = await verifyBackupDirectory(backup.directory);

    assert.equal(verification.ok, false);
    assert.match(verification.errors.join("\n"), /pages: expected 1 row\(s\), found 2/);
  } finally {
    await backup.cleanup();
  }
});

test("the restore check rejects an export with a missing collection", async () => {
  const workspace = workspaceWith();
  delete workspace.pages;
  const backup = await makeBackup({ workspace });

  try {
    const verification = await verifyBackupDirectory(backup.directory);

    assert.equal(verification.ok, false);
    assert.match(verification.errors.join("\n"), /missing the pages collection/);
  } finally {
    await backup.cleanup();
  }
});

test("the restore check rejects unreadable manifests and wrong formats", async () => {
  const wrongManifest = await makeBackup({
    manifest: { format: "something-else" },
  });
  const wrongWorkspace = await makeBackup({
    workspace: workspaceWith([], { format: "kbs-something-else" }),
  });

  try {
    const manifestCheck = await verifyBackupDirectory(wrongManifest.directory);
    assert.equal(manifestCheck.ok, false);
    assert.match(manifestCheck.errors.join("\n"), /not a version 1 KBS backup/);

    const workspaceCheck = await verifyBackupDirectory(wrongWorkspace.directory);
    assert.equal(workspaceCheck.ok, false);
    assert.match(workspaceCheck.errors.join("\n"), /not a version 1 KBS export/);
  } finally {
    await wrongManifest.cleanup();
    await wrongWorkspace.cleanup();
  }
});

test("backup summaries surface verification state", () => {
  const backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    id: "2026-11-07T00-00-00-000Z",
    createdAt: "2026-11-07T00:00:00.000Z",
    workspaceExport: "workspace.json" as const,
    counts: {},
    attachments: [{ id: "a", size: 4, sha256: "x" }],
    missingAttachments: ["b"],
    totals: { attachments: 1, bytes: 4 },
    verification: {
      checkedAt: "2026-11-07T00:01:00.000Z",
      ok: true,
      files: 1,
      missingFiles: [],
      errors: [],
    },
  } satisfies BackupManifest;

  assert.deepEqual(summarizeBackup(backup), {
    id: backup.id,
    createdAt: backup.createdAt,
    attachments: 1,
    bytes: 4,
    missingAttachments: 1,
    verified: true,
    errors: [],
  });
});
