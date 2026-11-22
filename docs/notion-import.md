# Importing a Notion workspace

`scripts/import-notion.ts` (`npm run import:notion`) copies everything shared with a
Notion integration into KBS: pages and their bodies, databases with typed
properties, their rows as records, relations, inline page links, and files.

Ids are derived deterministically from Notion ids, so re-running the importer
never duplicates an object: a second run only adds what is new. Every run that
writes records a manifest of exactly the rows and files it created, so an import
can be undone precisely.

Notion's API does not expose database views, button actions, or comments, so a
few things cannot be copied. They are listed under
[What is not imported](#what-is-not-imported).

## Setup

1. Create an internal integration at
   <https://www.notion.so/my-integrations> and copy its secret.
2. In Notion, share the pages and databases to import with that integration
   (••• → Connections → the integration). Child pages come with a shared page.
   A linked database view is not enough on its own: share the database it
   points at, or its rows cannot be read.
3. Point KBS at a database and apply the schema:

   ```bash
   npm run db:migrate
   ```

4. Provide the token and connection string. These are read from the environment
   or `.env`:

   | Variable | Purpose |
   | --- | --- |
   | `NOTION_TOKEN` | Required. Internal integration secret. |
   | `DATABASE_URL` | KBS PostgreSQL connection string. Required by every mode except `--dry-run`. |
   | `NOTION_ROOT_IDS` | Optional comma- or space-separated roots, combined with any `--root` flags. |
   | `NOTION_API_BASE` | Optional API base override; used by local test harnesses. |
   | `ATTACHMENTS_DIR` | Where file bytes are stored. Defaults to `data/attachments`, the directory the app reads. |

Import into an empty workspace unless you pass `--merge`.

## Quick start

```bash
# See what would be imported; writes nothing and downloads nothing.
npm run import:notion -- --dry-run

# Write it, keeping a manifest for an exact undo.
npm run import:notion

# Check that everything the conversion would import is actually in KBS.
npm run import:notion -- --verify
```

A partial import is limited with `--root`, which accepts a page, database or
data source id (or a Notion URL) and can be repeated:

```bash
npm run import:notion -- --root <page-id> --root <database-id>
```

Notion allows about three requests per second; the importer spaces requests and
retries throttled and server responses itself.

## Flags

| Flag | What it does | Writes |
| --- | --- | --- |
| `--root <id-or-url>` | Import one page, database or data source. Repeatable. Combined with `NOTION_ROOT_IDS`; with neither, every top-level object shared with the integration is imported. | — |
| `--merge` | Allow importing into a workspace that already has content. Existing objects keep their current content and parent; only missing rows are added. | Rows, files |
| `--dry-run` | Fetch and convert everything, then report. No rows are written, no files are downloaded or written, and no manifest is produced. | Nothing |
| `--dump <file>` | Also write the converted workspace (pages, databases, properties, views, records, relations, links, attachments, warnings) to JSON. The import itself still runs unless `--dry-run` is also passed. | The JSON file, plus the normal import |
| `--manifest <file>` | Where this run's manifest goes. Defaults to `data/import-manifests/notion-<timestamp>.json` (`/data` is gitignored). | The manifest |
| `--undo <manifest>` | Delete exactly the rows and files a recorded run created, then mark the manifest undone. Needs a typed confirmation unless `--yes` is passed; add `--dry-run` to preview. | Deletes rows/files |
| `--yes` | Skip the typed confirmation for `--undo`. | — |
| `--force` | Undo even when the manifest names a different database than `DATABASE_URL`. | — |
| `--verify` | Re-read Notion and compare its counts with KBS. Writes nothing; exits non-zero on a mismatch. | Nothing |
| `--retry-files` | Re-download the Notion-hosted files an earlier run left as Notion links and repoint the pages and records at them. Exits non-zero if a file still cannot be stored. | Attachment rows/files, page and record references |
| `--update` | Refresh existing pages, record titles and property values from Notion. Never inserts; only rows Notion edited after their stored timestamp are touched. | Existing rows, new media for changed content |
| `--help` | Print the usage above. | — |

Combination rules:

- `--undo` cannot be combined with import options (`--root`, `--merge`,
  `--verify`, `--retry-files`, `--update`, `--dump`, `--manifest`).
- `--verify` cannot be combined with `--merge`, `--dry-run`, `--dump` or
  `--manifest`.
- `--retry-files` and `--update` cannot be combined with `--merge`,
  `--dry-run`, `--verify`, `--dump` or `--manifest`; they accept `--root`.
- `--yes`/`--force` are only meaningful with `--undo`.

Exit codes: `0` on success; `1` for an error, for `--verify` mismatches, and for
`--retry-files` files that are still unavailable. `--update` exits `0` even when
it reports rows it kept because KBS is newer.

## What gets imported

| Notion | KBS |
| --- | --- |
| Page, nested page | Page, kept in the same parent/child order |
| Page body | KBS document (`content_json`) plus its plain-text mirror (`content`) |
| Page cover image, emoji icon | Page cover (downloaded), page icon |
| Inline link or mention of another page | `page_links` row and a link to the KBS page |
| Database (each data source) | Database with a table view, plus an inferred board (see [Views](#views)) |
| Database property | Typed KBS property (see [Property mapping](#property-mapping)) |
| Database row | Record plus its own page |
| Relation cell | `database_record_relations` row |
| Image, file, PDF, file property | Attachment row and file bytes (see [Files](#files)) |

### Pages

Titles, emoji icons, covers and the body are imported. Block support:

- paragraphs, headings 1–6, bulleted and numbered lists, to-dos, callouts,
  toggles, quotes, dividers, code blocks (with language), tables, columns
  (flattened), equations (as `$$ … $$` text), child pages, child databases and
  `link_to_page`;
- `video`, `audio`, `embed`, `bookmark` and `link_preview` become links;
- synced blocks are read from their original block (it must be shared with the
  integration);
- table of contents, breadcrumb, template and unsupported blocks are dropped;
- an unknown block keeps its text.

A page whose body cannot be read is imported without it and reported in the
warnings. Non-emoji (file/image) icons are not imported.

### Property mapping

| Notion type | KBS type | Notes |
| --- | --- | --- |
| `title` | — | Becomes the page and record title |
| `rich_text` | `text` | |
| `number` | `number` | |
| `checkbox` | `checkbox` | |
| `date`, `created_time`, `last_edited_time` | `date` | Created/last-edited values are stored as dates |
| `url` | `url` | |
| `email`, `phone_number`, `unique_id`, `people` | `text` | People become a comma-separated list of names |
| `files` | `file` | KBS keeps the first file; more than one is reported |
| `select` | `select` | Choices come from the schema and the imported values |
| `status` | `select` | Statuses and their groups become choices |
| `multi_select` | `multi_select` | |
| `relation` | `relation` | Only when the related database is part of the import; otherwise the property is skipped with a warning |
| `rollup` | `rollup` or a snapshot | See [Rollups](#rollups) |
| `formula` | `formula` or a snapshot | See [Formulas](#formulas) |
| `button` | — | Skipped; Notion's API does not expose the actions |
| anything else | — | Skipped with a warning |

### Rollups

A rollup becomes a real KBS rollup only when KBS computes the same thing:

| Notion function | Result |
| --- | --- |
| `count` | KBS `count` (counts the linked records) |
| `sum`, `average`, `min`, `max` | Mapped only when the summarized property is a KBS `number` property |

Everything else — `count_values`, `show_unique`, `percent_*`, date ranges,
`checked`, and rollups whose summarized property is not a number — is
**snapshotted**: the values Notion computed are stored in an ordinary column.
The snapshot is a `number` property when every value is numeric (or blank),
otherwise `text` with numbers stringified. A mapped rollup carries no copied
value, so the column is always the calculation.

### Formulas

Notion formula text is translated to KBS's formula language when it means the
same thing. Both languages do arithmetic over number properties, so these
translate one to one:

- numbers, `prop("Name")` references, `+ - * /`, parentheses;
- `round(value[, digits])`;
- Notion's function forms `add`, `subtract`, `multiply`, `divide` and
  `unaryMinus`.

KBS formulas may only read number, rollup and formula properties. A reference
to text, a date, a checkbox, a title or a dropped property makes the formula
untranslatable. So does anything KBS's language lacks: `if()`, `concat()`,
comparisons, dates, strings, `pow()`, `mod()`, and so on.

Untranslatable formulas are **snapshotted** like rollups: Notion's computed
values become a `number` column when all of them are numeric, otherwise a `text`
column. A formula that reads a formula which was itself snapshotted as text is
also snapshotted; one that reads a numeric snapshot can still be translated.
Every snapshot is reported with the reason (the operator, function or reference
that blocked it).

### Buttons

Notion returns a button property as `button: {}`: the API never exposes the
actions behind it, and a button cell holds no value to snapshot. Buttons are
therefore skipped with a warning naming the property. Recreate them in KBS with
the actions you want. The run summary counts them (`buttons: N skipped`).

### Files

Notion-hosted files are downloaded into `ATTACHMENTS_DIR` and stored as regular
KBS attachments, so imported pages do not depend on Notion's one-hour URLs. Each
attachment gets a deterministic id derived from where it sits in Notion (a page
cover, a block, or a record property), and the page or record references it as
`/api/attachments/<id>`.

- Stored types: `image/jpeg`, `image/png`, `image/gif`, `image/webp`,
  `image/avif` (images), plus PDF, plain text, CSV, Markdown, JSON, RTF, ZIP,
  GZIP, 7z, EPUB, Word, Excel, PowerPoint, OpenDocument text/sheets/slides.
- Maximum size: 10 MB per file.
- Anything else, or any failed download, is kept as a link to the Notion URL
  and reported. That URL expires; `--retry-files` is the fix.
- External (non-Notion) image and file URLs are kept as links and never
  re-downloaded by a retry.
- Files already on disk are not claimed by a new run, and `--undo` only removes
  the files a run actually wrote.

### Views

Notion's API does not expose a database's saved views, so the importer cannot
recreate their names, filters, sorts or layout. It creates:

- a **table** view for every database, always;
- a **board** view when the database has a status-like select with at least two
  choices. The property is, in order of preference, a property imported from
  Notion's `status` type, or a `select` named `Status`, `State`, `Stage`,
  `Phase` or `Priority`. The board groups by that property.

Every other database keeps the table alone: guessing a gallery, calendar or
timeline adds configuration the import cannot know. The summary reports both
counts, for example `views: 18 (12 board)`.

A **linked database view** is skipped with an explanation: Notion returns no
data source for it, so its columns and views cannot be imported. Its rows belong
to the database it points at, which is imported on its own when shared.

## Modes

### Default import and `--merge`

The default run requires an empty workspace (no pages) and writes everything
it converts. `--merge` allows adding to an existing workspace:
objects that already exist keep their content, parent and values, and only rows
that are missing are inserted. A run with `--merge` that finds nothing new
writes no manifest.

Both modes are insert-only. To refresh something that changed in Notion, use
`--update`.

### Manifest and `--undo`

Every run that writes records a manifest: the database it wrote to, the roots,
every row id per table that this run actually created (not rows that already
existed), and every file it wrote with its size. The manifest is written just
before `COMMIT` and removed if the transaction rolls back, so it never describes
uncommitted rows. It is skipped entirely when nothing new was written.

```bash
npm run import:notion -- --undo "data/import-manifests/notion-2026-11-22-10-30-00.json"
```

Undo is exact and defensive:

- a typed confirmation, unless `--yes`; `--dry-run` prints what would be removed;
- refuses a second undo of the same manifest (`undoneAt` is recorded);
- refuses when `DATABASE_URL` points at a different database than the one
  recorded, unless `--force`;
- deletes page links, relations, records, views, properties and databases by the
  ids in the manifest, unlinks imported parents, deletes the pages, and removes
  attachments only when nothing else still references them;
- also deletes the `notion_objects` ids for the pages, databases and records it
  removes, so the trash map never keeps ids for rows that are gone;
- deletes a file only when its size still matches the manifest.

`--undo` needs no `NOTION_TOKEN` and accepts no import flags.

### `--dry-run`

Fetches everything from Notion and converts it, then prints the summary and
warnings. No rows, no attachments, no downloads, no manifest. Because files are
not downloaded, media stays as Notion URLs in the model and the `files` count is
0 — a dry run reports what would be imported but not which files would be
stored. Combine with `--dump` for the full converted model.

### `--dump <file>`

Writes the converted workspace to JSON: pages, databases, properties, views,
records, relations, page links, attachments and warnings. This happens in
addition to the import, so use `--dry-run --dump <file>` when you only want the
preview. `--verify`, `--retry-files` and `--update` reject `--dump`.

### `--verify`

Repeats the conversion (downloading files to learn what it would store, but
writing no bytes) and checks KBS for every row and file it would import:

```
Verification against KBS (counts are what this conversion would import)
  pages:              672 of 672
  databases:          18 of 18
  properties:         127 of 127
  records:            607 of 607
  relations:          2228 of 2228
  files:              499 of 499 recorded, 499 of 499 on disk
```

- Rows are matched by the deterministic ids; relations by
  `(source record, property, target record)`.
- Files need both the attachment row and the bytes on disk, and the bytes must
  still be the size Notion serves.
- Mismatches are listed with counts and a sample of ids, and the command exits
  `1`. With no mismatch it exits `0`.

The verification block is preceded by the normal conversion summary (headed
`Notion → KBS import (verify)`), so the counts above are also printed there.

Verify **does not** compare content: it checks presence, not that a page body or
a value still matches Notion. Pages and records added to Notion after the import
therefore show up as missing until the next import or `--update`; edits to rows
that already exist are not detected. It also does not look at views or page
links, and it never counts unrelated rows that already exist in KBS.

`--verify` needs `NOTION_TOKEN` and `DATABASE_URL`. With `--root` it verifies
only that part of the workspace.

### `--retry-files`

Re-walks Notion without downloading, recording every Notion-hosted file with its
deterministic attachment id, then checks KBS:

- **already stored** (row and bytes present) — nothing is fetched, but the
  file is still offered as a replacement so an earlier run's stale reference
  can be rewritten;
- **missing** — downloaded, written as an attachment row and bytes, and then
  the references are rewritten: image `src`, file-block link `href`, page
  covers, and `files` property values (`attachmentId`, `url`, `filename`,
  `mimeType`).
- **still unavailable** — left as a Notion link, listed, and the command exits
  `1`.

URLs are matched ignoring their query string, because that is the signature
Notion re-issues every time it signs the URL. An expired URL stored months ago
still matches the same file, so retry does not depend on the old link working.

`--retry-files` does **not**:

- fetch a file whose row and bytes are already in place;
- touch external (non-Notion) URLs;
- create pages, records, relations or views;
- re-download a file kept as a link because KBS refuses its type — that fails
  again and is reported again;
- write a manifest (it only fills in missing attachments and fixes references).

Only Notion-hosted media (`file` and `file_upload`) is retried.

### `--update`

Refreshes an existing import in place, content and structure. It re-walks
Notion, reuses every stored attachment whose bytes are still on disk (so
unchanged media is not downloaded again), and rewrites only what Notion reports
as changed:

- page title, icon, cover, body (`content`) and `content_json`;
- a page's parent and its inline `page_links`, so a page moved or relinked in
  Notion moves and links the same way in KBS;
- record title, property values, and its `database_record_relations` for every
  relation property of its database;
- the database name, through its grouping page, plus its property schema
  (names, types, choices and order) and the table and board views the import
  infers;
- media the workspace does not already have, stored with the deterministic
  attachment ids.

The import stored Notion's `last_edited_time` on each row. A row is refreshed
only when Notion's timestamp is newer than the stored one. That keeps work done
in KBS after the import safe: when KBS is newer, the row is left alone, counted
under `newer in KBS`, and listed with both timestamps so a page that may now be
stale is never silent. The gate covers structure too: a page Notion did not
report as edited keeps its parent and links, a record keeps its relations, and a
database keeps its schema and views.

```
  pages:              672 checked, 3 updated
  records:            607 checked, 12 updated
  databases:          18 checked, 1 renamed
  attachments:        2 added
  not in KBS:         4 skipped (2 pages, 2 records — run the import first)
  newer in KBS:       1 pages, 0 records kept their local edits
  structure:          2 parents, 9 relations, 5 page links, 6 properties, 1 views
  trashed in Notion:   2 found, 2 still in KBS (kept)
```

A page, record or database Notion has moved to its trash is reported under
`trashed in Notion` and kept in KBS; `--update` never deletes content. Remove or
archive it in KBS if it should go.

Notion's search results and a page's children both omit trashed objects, so the
walk alone cannot name them. Every import and update therefore stores the Notion
id of each object it wrote in the `notion_objects` table. An update asks Notion
about the stored objects the walk did not reach, and reports the ones now in
the trash: a page trashed after the import is still named after it disappears
from its parent's children, and a trashed subtree is followed down to pages the
walk never saw. A stored object whose KBS row is gone is not reported, since
there is nothing left to keep.

Three cases remain out of reach: objects imported before `notion_objects`
existed have no stored id, objects Notion deleted permanently (rather than
trashed) return 404 and are not reported, and a `--root` run only probes objects
under the roots it was given, because everything else is missing from the walk
by choice.

Schema rows are the one kind `--update` may add: a property, relation, page link
or inferred view Notion has that KBS does not is created, because otherwise the
refresh could not describe Notion's structure. A new property's values appear on
the records Notion reports as edited, and a property Notion removed is left in
KBS with its values rather than deleted. Views you created yourself are never
touched; only the table and board views the import itself created are kept in
step, and the board is removed when its status-like select is gone.

Conversion warnings (an unreadable body, a failed download, a snapshot) are
printed after the report, as they are for `--retry-files`.

`--update` does **not**:

- insert pages, records, databases or attachments. Rows Notion has that KBS
  does not are reported as `not in KBS` and left alone; run the import first (it
  is insert-only and safe to re-run);
- delete anything Notion trashed or removed, including a property Notion
  dropped — a trashed page, record or database is reported instead;
- overwrite a row whose KBS timestamp is newer than Notion's, including its
  parent, links, relations, schema and views;
- create relations or page links that point at rows not in KBS; those pairs are
  skipped rather than failing the foreign key;
- fix files that were kept as Notion links — use `--retry-files` for that;
- write a manifest.

## Re-running and idempotency

Ids are deterministic (UUIDv5 over the Notion id and object kind). Re-running
the normal importer with `--merge` adds only objects that are new, and writes no
manifest when nothing was added. It never updates or deletes. For refreshing
changed content use `--update`; for files use `--retry-files`; for checking use
`--verify`.

## What is not imported

- **Database views.** Notion's API does not expose them, so filters, sorts,
  layout and view names are lost. Each database gets a table view, plus an
  inferred board over a status-like select.
- **Button actions.** The API returns `button: {}` and nothing else.
- **Comments and discussions.**
- **Non-emoji page icons** (uploaded images).
- **Notion people as users.** A `people` property becomes a text list of names;
  KBS has no workspace membership.
- **Synced blocks whose original block is not shared** with the integration.
- **Linked database views** — explained warning; share the source database.
- **Notion nested-page permissions.** Everything shared is imported as ordinary
  KBS content.

Further limits worth knowing:

- A data source query is capped by Notion at 10,000 rows; when the API reports
  the result as incomplete the import warns that some rows were not imported.
- A `files` property with several files keeps the first and warns.
- Rollups and formulas that cannot be computed in KBS keep a snapshot of
  Notion's values. The snapshot is not live: it does not update when the
  underlying records change.
- KBS has no per-user identity, so imported content is owned by the workspace.
- `--update` is timestamp-gated by design. There is no force override; a row
  whose KBS copy is newer is reported and left alone.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `NOTION_TOKEN is required` | Token missing from the environment or `.env`. |
| `Notion object … was not found, or it is not shared with this integration` | The page/database was not shared with the integration, or the id is wrong. |
| `Notion API 401` | The integration secret is wrong or revoked. |
| `DATABASE_URL is required …` | Every mode except `--dry-run` needs a database. |
| Many `image.png: the file server answered 500` warnings | The source host refused the download; files stay as Notion links. Re-run `--retry-files` later. |
| `--verify` reports missing pages after editing in Notion | Verification checks presence, not content; run `--update` (or the import) to bring the new rows in. |
| `--update` says `not in KBS` | The workspace was imported only partially; run the import (with `--merge`) to add the remaining rows. |
| `That manifest was recorded against database …, but DATABASE_URL points at …` | Undo is pointing at the wrong database; pass `--force` only if that is intended. |
| `… was already undone …` | The manifest was already used for an undo. |
