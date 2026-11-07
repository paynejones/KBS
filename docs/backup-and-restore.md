# Backup and restore

KBS stores a workspace in two places:

- **PostgreSQL** — pages, revisions, tags, links, databases, properties, views, records, templates, relations, and attachment metadata.
- **The attachments directory** — uploaded files, one file per attachment ID. It is `data/attachments` by default, or the path set in `ATTACHMENTS_DIR`.

A backup is only complete when both are captured. A PostgreSQL dump alone leaves page images and files behind.

## Option 1: full database dump (highest fidelity)

```bash
pg_dump --format=custom --file=kbs-backup.dump "$DATABASE_URL"
```

Restore into a separate, empty recovery database, run `npm run db:migrate`, and copy the attachments directory back before pointing the app at it:

```bash
pg_restore --no-owner --dbname="$RECOVERY_DATABASE_URL" kbs-backup.dump
```

This preserves every column exactly, including any data added by a newer app version.

## Option 2: workspace JSON export (portable and inspectable)

Open **Trash** in the app (sidebar → Trash → Backup) and choose **Download JSON export**, or fetch it directly:

```bash
curl --fail --silent --show-error "$APP_URL/api/export" -o kbs-export.json
```

The file contains `format: "kbs-export"`, `version: 1`, an `exportedAt` timestamp, per-table counts, and these collections:

| Key | Contents |
| --- | --- |
| `pages` | Every page, including trashed pages (`deletedAt` is set) |
| `pageRevisions` | Revision history for each page |
| `tags`, `pageTags`, `pageLinks` | Tags and explicit page links |
| `databases`, `databaseProperties`, `databaseViews` | Database structure and saved views |
| `databaseRecords`, `databaseTemplates`, `databaseRecordRelations` | Records, templates, and relation rows |
| `pageTemplates` | Saved page templates (name, title, content, and icon) |
| `attachments` | Attachment metadata (`id`, `filename`, `mimeType`, `size`, `createdAt`, `url`) |

Attachment **bytes** are not embedded in the JSON. Back up the attachments directory alongside the export.

## Option 3: full backup from the app or a scheduled job

Trash → Backup → **Back up now**, or:

```bash
npm run backup
```

Each run writes a dated folder to `data/backups` (or `BACKUPS_DIR`) containing:

| File | Contents |
| --- | --- |
| `workspace.json` | The same version 1 export described above |
| `attachments/<id>` | A byte-for-byte copy of every stored attachment |
| `manifest.json` | Row counts, each file's size and SHA-256 checksum, and the verification result |

Every backup is checked immediately: the manifest is re-read, each expected collection is compared with its recorded row count, and each attachment copy is compared with its recorded size and checksum. A failed check leaves the files in place for investigation, and the run exits non-zero. The same check can be repeated from Trash → Backup → **Check**, or by passing the folder to `--verify`.

For a scheduled backup, run the command from cron, a systemd timer, or Windows Task Scheduler. The job needs `DATABASE_URL`, `ATTACHMENTS_DIR`, and `BACKUPS_DIR` in its environment. Bound the history with `--keep`:

```bash
# Every day at 03:00, keep the 14 most recent backups.
0 3 * * * cd /srv/kbs && npm run backup -- --keep 14 >> /var/log/kbs-backup.log 2>&1
```

```bash
npm run backup -- --verify data/backups/2026-11-07T22-21-03-123Z
```

## Restoring a full backup

1. Create an empty PostgreSQL database, point `DATABASE_URL` at it, and run `npm run db:migrate`.
2. Restore the rows: `npm run restore:export -- data/backups/<id>/workspace.json`.
3. Copy `data/backups/<id>/attachments/*` into the live attachments directory (`data/attachments` or `ATTACHMENTS_DIR`).
4. Start the app and work through the verification checklist below.

## Restoring a JSON export

1. Create an empty PostgreSQL database and point `DATABASE_URL` at it.
2. Apply the schema: `npm run db:migrate`.
3. Restore the data: `npm run restore:export -- path/to/kbs-export.json`.
   - The script refuses to run against a workspace that already has pages; add `--force` to merge into an existing workspace (`ON CONFLICT DO NOTHING` keeps existing rows).
   - Rows are inserted with `jsonb_populate_recordset`, then page parents are linked in a second pass, so the import runs in one transaction and rolls back cleanly on failure.
4. Copy the attachments directory from the backup to `data/attachments` (or `ATTACHMENTS_DIR`). Attachment IDs in the export must match the file names in that directory. The script warns when files are missing.
5. Start the app and verify the checklist below.

The export is tied to the table shape at export time. If the schema gained columns after the export, restore with a database dump instead, or run the export through an app version that matches the data.

## Verify a restore

- Page counts match `counts.pages` minus pages you intentionally purged.
- A page with images or a cover renders its media.
- A database shows its properties, views, records, and relations.
- Trash lists the pages that were trashed at export time.
- Search finds a phrase from a restored page.

## Files and cleanup behavior

- Deleting a page moves it and its subpages to **Trash**. Nothing is removed from disk yet.
- **Delete forever** removes the page rows and then deletes attachments that no page, page revision, database record, or template references anymore.
- **Remove unused files** on the Trash screen scans every reference and deletes orphaned uploads. Revisions count as references, so files used only by an older revision are kept.

## Security

Exports and backups contain the full contents of the workspace, including every attachment. Store them outside the app container, restrict access, and encrypt them at rest. `/api/export` and the backup endpoints sit behind the single-user sign-in gate, but a signed-in session or a copy of the backups directory still exposes everything.
