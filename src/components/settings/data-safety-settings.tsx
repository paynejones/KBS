"use client";

import { useState } from "react";
import Link from "next/link";
import { Archive, Download, HardDrive, ShieldCheck, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { SettingsSection } from "@/components/settings/settings-section";

type BackupSummary = {
  id: string;
  createdAt: string;
  attachments: number;
  bytes: number;
  missingAttachments: number;
  verified: boolean;
  errors?: string[];
};

type OrphanSummary = { count: number; bytes: number };
type BackupBusy = "create" | "scan" | "clean" | `verify:${string}` | null;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DataSafetySettings() {
  const [backups, setBackups] = useState<BackupSummary[] | null>(null);
  const [backupsLoading, setBackupsLoading] = useState(false);
  const [backupsError, setBackupsError] = useState("");
  const [orphans, setOrphans] = useState<OrphanSummary | null>(null);
  const [orphanError, setOrphanError] = useState("");
  const [busy, setBusy] = useState<BackupBusy>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [confirmCleanUnused, setConfirmCleanUnused] = useState(false);

  async function loadBackups() {
    setBackupsLoading(true);
    setBackupsError("");
    setError("");
    setStatus("");
    try {
      const response = await fetch("/api/backup");
      const data: { backups?: BackupSummary[]; error?: string } = await response
        .json()
        .catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not load backup history.");
      setBackups(data.backups ?? []);
    } catch (backupFailure) {
      setBackupsError(
        backupFailure instanceof Error ? backupFailure.message : "Could not load backup history.",
      );
    } finally {
      setBackupsLoading(false);
    }
  }

  async function createBackup() {
    setBusy("create");
    setError("");
    setStatus("");
    try {
      const response = await fetch("/api/backup", { method: "POST" });
      const data: {
        backup?: BackupSummary;
        verification?: { ok: boolean; errors: string[] };
        error?: string;
      } = await response.json().catch(() => ({}));
      const backup = data.backup;
      if (!response.ok || !backup) {
        throw new Error(data.error ?? "Could not create the backup.");
      }
      setBackups((current) => [
        backup,
        ...(current ?? []).filter((entry) => entry.id !== backup.id),
      ]);
      setBackupsError("");
      setStatus(
        data.verification?.ok
          ? `Backup ${backup.id} created and checked: ${backup.attachments} file(s), ${formatBytes(backup.bytes)}.`
          : `Backup ${backup.id} was created but the check failed: ${data.verification?.errors[0] ?? "unknown problem"}.`,
      );
    } catch (backupFailure) {
      setError(
        backupFailure instanceof Error ? backupFailure.message : "Could not create the backup.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function verifyBackup(backup: BackupSummary) {
    setBusy(`verify:${backup.id}`);
    setError("");
    setStatus("");
    try {
      const response = await fetch(`/api/backup/${backup.id}/verify`, { method: "POST" });
      const data: {
        backup?: BackupSummary;
        verification?: { ok: boolean; errors: string[] };
        error?: string;
      } = await response.json().catch(() => ({}));
      const checked = data.backup;
      if (!response.ok || !checked) {
        throw new Error(data.error ?? "Could not check the backup.");
      }
      setBackups((current) =>
        current?.map((entry) => (entry.id === checked.id ? checked : entry)) ?? current,
      );
      setStatus(
        data.verification?.ok
          ? `Backup ${checked.id} passed the restore check.`
          : `Backup ${checked.id} failed the restore check: ${data.verification?.errors[0] ?? "unknown problem"}.`,
      );
    } catch (verifyFailure) {
      setError(
        verifyFailure instanceof Error ? verifyFailure.message : "Could not check the backup.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function scanOrphans() {
    setBusy("scan");
    setOrphanError("");
    setError("");
    setStatus("");
    try {
      const response = await fetch("/api/attachments/orphans");
      const data: { count?: number; bytes?: number; error?: string } = await response
        .json()
        .catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not scan stored files.");
      setOrphans({ count: data.count ?? 0, bytes: data.bytes ?? 0 });
    } catch (scanFailure) {
      setOrphanError(
        scanFailure instanceof Error ? scanFailure.message : "Could not scan stored files.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function removeUnusedFiles() {
    if (!orphans || orphans.count === 0) return;
    setBusy("clean");
    setError("");
    setStatus("");
    try {
      const response = await fetch("/api/attachments/orphans", { method: "DELETE" });
      const result: { removed?: number; bytes?: number; error?: string } = await response
        .json()
        .catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Could not remove the unused files.");
      setOrphans({ count: 0, bytes: 0 });
      setConfirmCleanUnused(false);
      setStatus(
        (result.removed ?? 0) > 0
          ? `Removed ${result.removed} unused file(s) and freed ${formatBytes(result.bytes ?? 0)}.`
          : "No unused files were removed.",
      );
    } catch (cleanFailure) {
      setConfirmCleanUnused(false);
      setError(
        cleanFailure instanceof Error
          ? cleanFailure.message
          : "Could not remove the unused files.",
      );
    } finally {
      setBusy(null);
    }
  }

  const scopeLabel =
    orphans === null
      ? "Not checked yet."
      : orphans.count === 0
        ? "No unused files found."
        : `${orphans.count} unused file${orphans.count === 1 ? "" : "s"} · ${formatBytes(orphans.bytes)}`;

  return (
    <SettingsSection
      id="data"
      title="Data & backups"
      icon={<Archive size={17} className="text-muted-foreground" aria-hidden="true" />}
      description="Create and check workspace backups, review storage, and remove files that no page references."
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2.5">
          <div>
            <p className="text-sm font-medium">Workspace backup</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Export a portable JSON copy or create a verified server-side backup.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/api/export"
              download
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Download size={14} aria-hidden="true" /> Download JSON
            </Link>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void createBackup()}
              disabled={busy !== null}
            >
              <Archive size={14} aria-hidden="true" />{" "}
              {busy === "create" ? "Backing up…" : "Back up now"}
            </Button>
          </div>
        </div>

        <div className="rounded-lg border bg-background px-3 py-2.5">
          {backups === null ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Backup history</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Load backups only when you need to check one.
                </p>
              </div>
              {backupsError ? (
                <div className="flex flex-col items-end gap-1.5">
                  <p role="alert" className="text-xs text-destructive">
                    {backupsError}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void loadBackups()}
                    disabled={backupsLoading}
                  >
                    Try again
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void loadBackups()}
                  disabled={busy !== null || backupsLoading}
                >
                  <Archive size={14} aria-hidden="true" />{" "}
                  {backupsLoading ? "Loading backups…" : "Show backup history"}
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">Backup history</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void loadBackups()}
                  disabled={busy !== null || backupsLoading}
                >
                  {backupsLoading ? "Refreshing…" : "Refresh"}
                </Button>
              </div>
              {backupsError && (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  {backupsError}
                </p>
              )}
              {backups.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">No backups yet.</p>
              ) : (
                <ul className="mt-2 divide-y rounded-md border">
                  {backups.map((backup) => (
                    <li
                      key={backup.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs font-medium">{backup.id}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {new Date(backup.createdAt).toLocaleString()} · {backup.attachments}{" "}
                          file(s) · {formatBytes(backup.bytes)}
                        </p>
                        {backup.errors && backup.errors.length > 0 && (
                          <p className="mt-0.5 text-xs text-destructive">{backup.errors[0]}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={
                            backup.verified
                              ? "text-xs font-medium text-emerald-700 dark:text-emerald-400"
                              : "text-xs font-medium text-destructive"
                          }
                        >
                          {backup.verified ? "Checked" : "Check failed"}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label={`Check backup ${backup.id}`}
                          onClick={() => void verifyBackup(backup)}
                          disabled={busy !== null}
                        >
                          <ShieldCheck size={13} aria-hidden="true" />{" "}
                          {busy === `verify:${backup.id}` ? "Checking…" : "Check"}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2.5">
          <div>
            <p className="text-sm font-medium">Unused files</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{scopeLabel}</p>
            {orphanError && (
              <p role="alert" className="mt-1 text-xs text-destructive">
                {orphanError}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {orphans !== null && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void scanOrphans()}
                disabled={busy !== null}
              >
                <HardDrive size={14} aria-hidden="true" />{" "}
                {busy === "scan" ? "Scanning…" : "Scan again"}
              </Button>
            )}
            {orphans === null && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void scanOrphans()}
                disabled={busy !== null}
              >
                <HardDrive size={14} aria-hidden="true" />{" "}
                {busy === "scan" ? "Scanning…" : orphanError ? "Try again" : "Scan for unused files"}
              </Button>
            )}
            {orphans !== null && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmCleanUnused(true)}
                disabled={busy !== null || orphans.count === 0}
              >
                <Trash2 size={14} aria-hidden="true" /> Remove unused files
              </Button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {status}
        </p>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        Restore instructions and the Trash live in <Link href="/trash" className="underline">Trash</Link>.
      </p>

      <AlertDialog open={confirmCleanUnused} onOpenChange={setConfirmCleanUnused}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove unused files?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently remove {orphans?.count ?? 0} stored file
              {orphans?.count === 1 ? "" : "s"} that no page references? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void removeUnusedFiles()}>
              <Trash2 size={14} aria-hidden="true" /> Remove files
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}
