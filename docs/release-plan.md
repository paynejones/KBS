# Release plan — v0.4.0 to v0.6.0

Planning date: 2026-11-19; the 0.5.0 section was added 2026-11-24 and the 0.6.0
plan on 2026-11-28. The 0.4.0 plan below was written when `package.json` still
said `0.3.0`, the latest migration was `0028_database_grouping_page`, and the
repository had no tags. It shipped on 2026-11-22 as `v0.4.0`. The current release
is `0.5.0` and the latest migration is `0029_notion_object_map`; nothing in the
0.6.0 section is implemented yet.

## v0.6.0 — the daily driver (planned)

Written 2026-11-28, when `package.json` says `0.5.0`, the latest migration is
`0029_notion_object_map`, and the last release shipped three days earlier. This
plan is scoped but not started: no file below has been touched.

### Theme

Shorten the loop the app is used for every day. Plan repeating work without
retyping it, see what has gone stale without hunting for it, save the cuts that
are opened constantly, act without aiming, and change a screenful of records at
once. The constraint is the same one 0.4.0 set: no new property type, no second
data model for tasks, and no background worker the deployment cannot host.

### Scope

| # | Item | Size | Effort | Files | Why it is in |
| --- | --- | --- | --- | --- | --- |
| 1 | Recurring records | L | 3 days | `drizzle/0031_record_recurrences.sql` (new), `src/db/schema.ts`, `src/lib/recurrence.ts` (new), `src/app/api/databases/[id]/records/[recordId]/route.ts`, `src/components/database-record.tsx`, `src/components/database-workspace.tsx` | The one capability the app is missing every week: a task that comes back |
| 2 | Review page | M | 2 days | `src/app/review/page.tsx` (new), `src/app/api/review/route.ts` (new), `src/lib/review.ts` (new), `src/lib/navigation.ts` | Everything the app knows about staleness already exists; nothing surfaces it |
| 3 | Saved searches with typed filters | M | 2.5 days | `drizzle/0030_saved_search_filters.sql` (new), `src/lib/saved-searches.ts`, `src/lib/page-listing.ts` (new), `src/app/api/pages/route.ts`, `src/components/saved-searches.tsx` | Collections still ask only for a term, a tag, and favorites, while views already filter by type |
| 4 | Palette actions and a shortcut cheat sheet | S | 1 day | `src/components/command-palette.tsx`, `src/lib/shortcuts.ts` (new), `src/components/editor-toolbar.tsx` | The palette is the keyboard's front door and is missing capture, records, and collections |
| 5 | Bulk record edit | M | 2 days | `src/components/database-workspace.tsx`, `src/components/database-cell-editors.tsx`, `src/app/api/databases/[id]/records/bulk/route.ts` (new) | Editing twenty rows means twenty round trips and twenty clicks today |
| 6 | Release pass | S | 1 day | `package.json`, `CHANGELOG.md`, docs | Same mechanics as 0.5.0: version, changelog, tag, deploy, post-deploy checks |

Roughly 11–12 working days, not counting a mockup pass. Items 1 and 2 carry the
new behaviour and the risk; items 3–5 are smaller and shippable on their own.

### 1. Recurring records (L, 3 days)

A repeat rule belongs to a database record, not to a checkbox in a page body.
Editor task lists are `taskItem` nodes with no stable id: `src/lib/focus.ts`
addresses one by its document path and `task_completions` keys it by page and
text, so "this task repeats every second Tuesday" has nothing durable to attach
to and would break the first time a block is inserted above the list. Page task
lists therefore stay manual (see **Not in this release**), and a task that must
repeat is a record with a date — which the app already supports end to end.

- New table `record_recurrences` (migration `0031`): `record_id` (primary key,
  cascades with the record), `property_id` (the date property it advances),
  `rule` jsonb, `created_at`. One rule per record; changing it replaces it.
- Cadences in `src/lib/recurrence.ts`, computed on date-only strings like the
  rest of the calendar code: daily, every N days, weekly on chosen weekdays,
  monthly on a day of the month, every N months, every N weeks.
- Advancing happens in place. The record's date moves to the next occurrence and
  no copy is created, so Due soon, the timeline, calendar views, and every saved
  filter keep working with no second record to reconcile. The alternative — a
  new record per occurrence — is a different release; see **Risks**.
- One explicit trigger: **Complete and schedule next** on the record page, and
  the same action in the bulk bar when every selected record has a rule. The app
  has no scheduler and the deployment cannot host one, so inferring completion
  from a status property would still only fire when someone opens the app; an
  explicit action is honest about that and is testable without a clock.
- Missed occurrences are reached from the review page's overdue section:
  **Roll forward** sets the date to the first occurrence after today, in one
  request, for one record or for all of them.
- History reuses `task_completions` for the record's page, keyed by the record
  title, so a pinned project card's **Recently finished** list shows the
  completions without a per-occurrence table.
- The rule is edited beside the date property in the record's property rail,
  with a summary in words ("Every second Tuesday") rather than a rule string;
  the date cell in a view shows a small repeat marker.
- A record whose rule points at a deleted property, or at a property that is no
  longer a date, keeps the row but stops offering the action, matching how a
  deleted tag leaves a saved search intact.

### 2. Review page (M, 2 days)

A read-only screen at `/review`, reachable from the sidebar, the palette, and
the home page, that answers "what has drifted?" from data the app already
stores. No migration: every section is a query over existing tables.

| Section | Source | Action it links to |
| --- | --- | --- |
| Due today and overdue | Records with a date property in the past 7 days | The record, and **Roll forward** when it has a rule |
| Going stale | Pages not updated in 30 or 90 days, excluding record pages and inbox | The page |
| Unfiled captures | Inbox items older than 7 days | The inbox item |
| Stalled reading | Reading items in **Reading** with no update in 14 days | The item |
| Unconnected | The counts `/api/orphans` already computes | `/orphans` |
| Finished this week | `task_completions` since Monday | The page that held each task |

- Thresholds live in the URL, the way the page browser already keeps its filters
  (`src/lib/listing-link.ts`), so a review is bookmarkable and the back button
  behaves.
- Every section caps its preview at a handful of rows and shows the true count;
  the count and the preview come from one predicate so they cannot disagree.
- Empty sections say which threshold made them empty, not just "nothing here".
- Read-only in this release. The only write is **Roll forward**; anything that
  edits, archives, or snoozes is 0.7.0 (see **Risks**).
- One request, `GET /api/review`, returns every section, so opening the page is a
  single round trip. Sections that a workspace cannot fill (no reading items, no
  inbox) are omitted rather than shown empty.

### 3. Saved searches with typed filters (M, 2.5 days)

A saved search today stores `query`, `tagId`, and `favoritesOnly`
(`src/db/schema.ts`, `src/lib/saved-searches.ts`), and the collection screens ask
`/api/pages` for `q`, `tagId`, and `favorite`. A database view, by contrast,
stores typed filters with operators and a value (`parseViewFilters` in
`src/lib/database-view.ts`, capped at 12). Collections should reach the same
level without inventing a second query language.

- Add `filters jsonb not null default '[]'` to `saved_searches` (migration
  `0030`), in the same `{ id, propertyId, operator, value }` shape as a view, so
  the two filter editors can share parsing and validation.
- The filterable "properties" of a page are its fields: title and body text, tag,
  favorite, created date, updated date, inbox flag, has children, and no
  connections. Operators come from the same vocabulary as views: `contains`,
  `does not contain`, `is`, `is not`, `is empty`, `is not empty`, `before`,
  `after`, `is checked`, `is not checked`.
- Migration `0030` also backfills every existing collection into a filter array,
  so a collection created in 0.5.0 lists the same pages after the upgrade. The
  three legacy columns stay and keep being written: exports, the restore script,
  and the home widget read them, and dropping them is a separate change.
- Move the predicate out of `src/app/api/pages/route.ts` into
  `src/lib/page-listing.ts`: one builder that turns `{ query, tagId, favorite,
  filters, date bounds, record-page and inbox flags }` into the `and(...)` the
  listing uses today. `/api/pages` and the new
  `GET /api/saved-searches/[id]/results` both call it, so a collection and the
  page browser cannot drift.
- Relative dates (`today`, `is before today`) resolve on each visit, like
  `isRelativeDateValue` in the database views, so a collection stays live
  instead of freezing the day it was saved.
- The create form and the card summary follow: the three-field sentence becomes
  a filter summary ("Tag: research · Updated in the past 7 days"), built by
  `describeSavedSearch`.

### 4. Palette actions and a shortcut cheat sheet (S, 1 day)

The palette already loads pages, databases, templates, and recents, and owns
Ctrl/Cmd+K. It offers navigation and creation, but not the actions a daily user
reaches for first.

- **Capture to inbox** — a title field (and optional URL), through the existing
  `/api/inbox` route, then open the new capture.
- **New record in…** — a database picker over the already-loaded database list,
  then create through `/api/databases/[id]/records` and open the record's page.
- **Open a collection** — saved searches currently appear only as the
  destination; list each collection by name and open `/searches/<id>`.
- **Favorite / unfavorite this page** and **Copy link to this page** — both need
  the current page, which the palette already reads from the URL.
- **Toggle database pages** — flips the existing navigation preference, so a
  record page can be hidden from the tree without opening settings.
- No new palette chrome: items join the existing groups and matching, and the
  list stays ordered so search results are not buried under commands.
- **A cheat sheet**: `?` opens a dialog of global and editor shortcuts. The list
  lives in `src/lib/shortcuts.ts` and both the dialog and the editor toolbar's
  existing hint read it; a test asserts every listed shortcut is one the editor
  or shell actually handles, which is the same drift the 0.4.0 theme allowlist
  taught us to prevent.

### 5. Bulk record edit (M, 2 days)

- Table view only, and desktop only: a leading checkbox column, shift-click for
  a range, a page-level select-all (the rows on screen, never "every record
  matching the filter"), and Esc to clear. Board, gallery, list, and timeline
  keep their single-record editing.
- A bar above the table, in the same place the view controls sit, offers the
  operations that make sense in bulk: set a select value, set a multi-select
  value, check or uncheck, set a date, and delete. Title is set one at a time;
  formula and rollup are computed; relation, file, and button need per-record
  validation and stay out.
- `PATCH /api/databases/[id]/records/bulk` takes `{ recordIds, values }` with at
  most 200 ids — the same bounded listing cap `/api/pages` already uses —
  validates the property once with `validateDatabaseRecordValues`, and writes a
  single transaction, so one bad value leaves every record untouched. One
  `updatedAt` bump for the batch.
- Delete reuses the accessible confirmation, names the count, and says that
  record pages are kept. Deleting is one request but is still the destructive
  action, so it is last in the bar and never the default focus.
- The selection clears after a successful write and the table shows the new
  values without a full reload; a failed write keeps the selection so the bar
  can be retried.

### Migrations

| Migration | Change | Backfill | Reversible |
| --- | --- | --- | --- |
| `0030_saved_search_filters` | Adds `saved_searches.filters` jsonb, default `'[]'` | Yes: one `UPDATE` per existing row, converting `query`/`tag_id`/`favorites_only` into filter entries | Drop the column; the legacy columns still hold the old filters |
| `0031_record_recurrences` | New table `record_recurrences`, cascading from `database_records` and `database_properties` | None | Drop the table; records keep their dates |

Neither changes an existing column or drops data; the only write to existing
rows is the `0030` backfill. `drizzle-kit generate` writes the DDL; the backfill
is hand-added to the generated file, as `0027_attachment_references` already
does with its triggers. `npm run db:migrate` must report nothing pending on a second run, and
the upgrade path (a 0.5.0 database with real collections) is tested, not just the
empty database.

### Effort and sequence

1. **Typed collections (2.5 days).** Shared predicate in `src/lib/page-listing.ts`
   first, with a parity test against the existing listing; then migration `0030`
   and its backfill; then the form and summaries. Everything else that filters
   pages depends on this, including the review page's counts.
2. **Review page (2 days).** Sections on top of the shared predicate, the
   orphans and reading queries, and `task_completions`. No migration, so it can
   be cut without touching data.
3. **Palette actions and cheat sheet (1 day).** Independent of the rest; land it
   whenever there is a free day.
4. **Bulk edit (2 days).** Independent, but the recurrence action joins its bar,
   so it should land before item 5.
5. **Recurring records (3 days).** Migration `0031`, `src/lib/recurrence.ts`
   with its date-math tests, the completion endpoint, the property rail, the
   bulk action, and the review's **Roll forward**.
6. **Release pass (1 day).** Full CI, docs, changelog, version, tag, deploy, and
   the post-deploy checks below.

Each step is its own commit series on `main`. If time runs short, 1, 3, and 4
still make a coherent release; 2 and 5 are the ones to cut first because they
carry the most new behaviour.

### Acceptance criteria

- `npm test`, `npm run test:api`, `npm run test:db`, `npm run lint`,
  `npx next typegen`, `npx tsc --noEmit`, `npm run check:build-warnings`, and
  `npm run test:browser` pass locally and in CI.
- `npm run db:migrate` on an empty database creates `record_recurrences` and the
  `filters` column and reports nothing pending on a second run.
- Upgrading a 0.5.0 database: every existing saved search lists the same count
  and the same first page as before the migration, and its card names the
  filters it was converted from.
- Recurrence: a weekly rule advances from the record's own date, not from the
  day it was completed; a monthly rule on the 31st lands on the last day of a
  short month and returns to the 31st in a long one; a record completed early
  advances to the first occurrence after today; **Roll forward** twice does not
  skip an occurrence; a record with no date property cannot be given a rule; a
  deleted date property leaves the rule inert instead of erroring.
- Review: each section's count equals the count its destination shows for the
  same filters; empty sections name their threshold; the page writes nothing
  except **Roll forward**.
- Collections: a typed filter on tag and updated date returns the same pages as
  the page browser with the same filters; a relative date still resolves after
  midnight; a filter pointing at a deleted tag is ignored rather than hiding
  everything; a collection with no filters behaves as it did in 0.5.0.
- Palette: every new command is reachable with the keyboard alone; the cheat
  sheet lists only shortcuts that work; Escape closes both surfaces.
- Bulk edit: 201 ids are refused with a message and 200 are accepted; a value
  that is invalid for the property rejects the whole batch and leaves every
  record unchanged; computed, relation, file, and button properties are not
  offered; the selection clears on success and survives a failure.
- A production build serves `/review`, a collection, and a database table, and
  an unauthenticated `/api/review` returns `401` like every other API route.

### Acceptance run

Recorded on the release-pass tree, in the form the 0.4.0 and 0.5.0 runs used:
command output counts, the migration results against both a fresh database and a
0.5.0 copy, and the browser suite's touched specs.

### Not in this release

- Repeating editor task items. Task lists stay manual because `taskItem` nodes
  have no stable identity; recurrence is a record capability.
- Reminders, notifications, email, digests, and any scheduler. The deployment is
  one app container and a database; there is no worker to run a clock.
- One row per occurrence. Advancing in place keeps one record; a completion log
  of every occurrence would be a new table and a second source of truth for
  "what is due".
- Offline/PWA, share links or public publishing, comments and mentions,
  multi-user, AI, automation, webhooks, integrations.
- New property types (created/updated time, ID, person, status), footer
  calculations, drag-to-reschedule on the calendar, conditional colours, and
  second-level grouping.
- Bulk selection in board, gallery, list, or timeline; bulk relation or file
  edits; bulk title edits.
- A review workflow with snooze, dismiss, or archive actions.

### Risks and decisions

- **The recurrence model is the release's one real fork.** Advancing in place
  keeps the due queue, calendar, and every saved filter working with no second
  record, and it is the only option that needs no scheduler. It loses the
  history of past occurrences beyond the completion log. If per-occurrence
  history turns out to be required, that is a new table, a new "instances"
  concept, and a 0.7.0 item — decide before writing the endpoint, not after.
- **Date math is where recurrence bugs live.** Month-end clamping, a monthly
  rule anchored on the 29th–31st, and a weekly rule across a DST change are the
  three cases to pin with tests before the UI exists. Everything computes on
  date-only strings; nothing derives a date from a `Date` plus milliseconds.
- **Completion is explicit, so a user can forget it.** The review page's overdue
  section is the backstop, and it is why item 2 is not optional padding: without
  it, a missed recurring record is just an overdue one. If item 2 is cut, item 5
  ships with a visible overdue count on the home page instead.
- **The `0030` backfill rewrites every collection.** Run it against a copy of
  production and compare counts before and after, and write the `UPDATE` to skip
  any row that already has filters so a re-run cannot double them up.
- **Moving the listing predicate is a refactor in the hot path.** Search, the
  page browser, the home widgets, and every collection read it. Keep
  `tests/api/routes.test.ts` covering the same cases before and after, and add
  the parity test in the same commit as the extraction rather than later.
- **Bulk writes can be a footgun.** One transaction and a 200-record cap are the
  guard rails; delete stays behind the dialog that says record pages are kept.
  A bulk date set on a recurring record must not silently become the new anchor
  without saying so in the bar's confirmation.
- **The review page is the scope-creep risk.** It is read-only this release. The
  first "snooze this page for a week" request turns it into a workflow with its
  own state, and that state has to live somewhere the backup covers.
- **The palette can get noisier.** It already carries navigation, creation,
  templates, recents, favorites, pages, databases, and live results. New items
  join existing groups, are matched only on their own labels, and a test pins the
  order so results keep priority over commands.

### Release steps

1. Release mechanics: `package.json` says `0.6.0`, `CHANGELOG.md` has a 0.6.0
   section naming migrations 0030 and 0031, and the release commit is tagged
   `v0.6.0` (push only when authorized).
2. CI is green on the release commit, including the new recurrence, review,
   collection-filter, and bulk-edit tests.
3. `npm run db:migrate` applies 0030 and 0031 on a fresh database and on a 0.5.0
   copy; the second run reports nothing pending.
4. The push to `main` starts `release.yml`, which migrates before recreating the
   app container, so the backfill runs as part of the normal step. Take a backup
   first: `npm run backup`.
5. Post-deploy: `/signin` answers, an unauthenticated `/api/review` returns
   `401`, a collection still lists the pages it listed before the upgrade, one
   recurring record advances by one occurrence, one bulk edit over five records
   writes and rolls back cleanly when given a bad value, and a backup verifies.

### Release checklist

1. Working tree clean; CI green on the release commit.
2. `npm run backup` against the production copy, and the backup verifies.
3. Migrations applied on a copy first, with the collection counts compared.
4. `CHANGELOG.md` and `package.json` updated; tag `v0.6.0` with the release
   commit (push only when authorized).
5. `release.yml` deploys; the migration step succeeds before the app container is
   recreated.
6. Post-deploy checks above, then the deployed commit SHA recorded in the
   changelog entry.

## v0.5.0 — Notion import and hardening (current release)

Two commits landed after the `v0.4.0` tag: the Notion importer (`5e1beca`,
`768b78b`) with migration `0029_notion_object_map`. Every "no schema change" or
"no new migration" statement in the 0.4.0 sections below describes 0.4.0 only.

### What changed since v0.4.0

| Change | Where | Why it is in 0.5.0 |
| --- | --- | --- |
| Notion importer: `--dry-run`, `--dump`, `--verify`, `--retry-files`, `--update`, `--merge`, `--prune-trashed`, `--restore`, `--undo` | `scripts/import-notion.ts`, [importing a Notion workspace](notion-import.md) | The release's feature, and its only new user-facing capability |
| `notion_objects` table (migration `0029`) | `drizzle/0029_notion_object_map.sql`, `src/db/schema.ts` | `--update` and `--prune-trashed` need the stored Notion ids. Additive: one new table, no backfill |
| The Notion suite in CI | `.github/workflows/ci.yml` | A 6,600-line importer with a 1,300-line suite must gate a release like everything else |
| Refuse IPv4-mapped, IPv4-compatible, and NAT64 IPv6 in link previews | `src/lib/link-preview.ts` | `http://[::ffff:7f00:1]/` reached loopback through the preview fetch |
| Trust `X-Forwarded-For` only with `KBS_TRUST_PROXY`, last hop only, and delay instead of block when no address is known | `src/lib/auth.ts`, the two auth routes, `docs/deployment-readiness.md`, `README.md` | A client-set header could reset the sign-in throttle, and a single shared bucket let any caller lock the owner out |

### Release steps

1. Release mechanics: `package.json` says `0.5.0`, `CHANGELOG.md` has the 0.5.0
   section naming the importer and migration 0029, and the release commit is
   tagged `v0.5.0` (push only when authorized).
2. CI: `test:notion` now runs in the `verify` job, so `release.yml` cannot ship a
   commit whose importer suite fails.
3. Docs: the runbook's release checklist names migration 0029 and the
   `KBS_TRUST_PROXY` requirement, and `README.md` lists the variable.
4. Deploy: the push to `main` — not the tag — starts `release.yml`, which runs the
   migration before recreating the app, so 0029 applies as part of the normal
   step. There is no one-time backfill for it.
5. Post-deploy: `/signin` answers, an unauthenticated `/api/pages` returns `401`,
   one page save round-trips, one link capture produces a preview, and — only
   when a proxy is in front — failed sign-ins are counted per real address.

### Acceptance criteria

- `npm test`, `npm run test:api`, `npm run test:notion`, `npm run test:db`,
  `npm run lint`, `npx next typegen`, `npx tsc --noEmit`,
  `npm run check:build-warnings`, and `npm run test:browser` pass locally and in
  CI.
- `npm run db:migrate` on an empty database creates `notion_objects` and reports
  nothing pending on a second run.
- Link previews refuse `http://[::ffff:127.0.0.1]/`, `http://[::ffff:a9fe:a9fe]/`,
  `http://[::127.0.0.1]/`, and `http://[64:ff9b::7f00:1]/`, and still preview a
  public URL, including its hex mapped form.
- Sign-in throttling ignores `X-Forwarded-For` unless `KBS_TRUST_PROXY` is set.
  With it, the last hop is used, so a forged first hop cannot spend another
  address's allowance, and a blocked address does not affect a second one.
- With no trusted proxy, repeated wrong passwords never return `429`: each pays
  the 500 ms delay, and a correct password still signs in.
- A throttled address gets `429` for a wrong guess but `200` for the correct
  password, so spending the allowance cannot lock the owner out.
- `npm run import:notion -- --dry-run` then `--verify` complete against a test
  integration, and `--undo` of that run leaves the workspace as it was.

### Not in this release

- Multi-user identity, workspace membership, sharing, or any per-user isolation.
- Two-way Notion sync. `--update` pulls Notion's edits into KBS; nothing is
  written back, and a KBS edit newer than Notion's is kept.
- Notion comments (KBS has no comment model), buttons, linked database views, and
  Notion-hosted video or audio, which stay links because their URLs expire.

### Risks

- **Importer size.** It is the largest script in the repository and it writes to
  every table. Run `--dry-run` and then `--dump` against a production copy, and
  keep the manifest until the imported workspace looks right.
- **`KBS_TRUST_PROXY` is a deployment change.** A host behind a reverse proxy
  keeps working without it, but falls back to the delay: about two guesses a
  second per connection instead of 8 attempts per 10 minutes per address. It must
  not be set on a directly exposed instance, where a caller can forge the hop
  the app would read.
- **The IPv6 check is hand-written.** It is covered for mapped, compatible,
  NAT64, link-local, unique-local, and multicast forms plus a public control;
  extend `tests/link-preview.test.ts` before changing it.

## Where 0.3.0 leaves us

- All seventeen UI feedback items are implemented. The only open scope left in
  [the backlog](ui-feedback-backlog.md) is #14 (graph visual polish, which needs
  a direction) and the deferred extras on #12 (more widget types, finer sizing,
  saved-search widget links).
- The editor, capture, databases, graph, focus, reading, saved searches, and
  backups are feature-complete against the near-term roadmap; every remaining
  roadmap bullet is unchecked multi-user work or a launch decision.
- The release path already exists: CI runs the logic, API, database, lint, type,
  build, and browser suites, and `release.yml` migrates before recreating the
  app container.
- Two release mechanics are missing: there is no `CHANGELOG.md`, and no release
  has ever been tagged.

## Defect found while planning

`src/app/layout.tsx` has a pre-hydration theme script whose allowlist is stale:

```ts
if (["light", "dark", "warm", "forest"].includes(theme)) { ... }
```

The app ships seven themes (`slate`, `rose`, and `midnight` were added later in
`src/app/globals.css` and `src/components/theme-picker.tsx`). Choosing one of
the three newer palettes therefore paints the default theme until React
hydrates, and `midnight` misses the `.dark` class in that same window. The
allowlist and the dark-theme set must come from one shared source so this cannot
drift again. This is small, user-visible, and should ship first.

## Theme for v0.4.0

**Polish and confidence.** No new data model and, ideally, no new migration:
finish the remaining feedback, remove the papercuts that only show up after
daily use or a real build, and make the next release repeatable. Feature work is
limited to the two items the backlog already asks for. Multi-user identity stays
out, as the roadmap and deployment runbook both require.

## Scope

| # | Item | Size | Files | Why it is in |
| --- | --- | --- | --- | --- |
| 1 | Fix the pre-hydration theme allowlist and dark-theme set | XS | `src/app/layout.tsx`, `src/lib/theme*` or `theme-picker.tsx` | Confirmed defect; a flash of the wrong palette on every load with the newer themes |
| 2 | Graph visual polish (#14), bounded | L | `src/components/graph-workspace.tsx`, `src/lib/graph.ts`, `globals.css` | Last open feedback item; make it a finite list, below |
| 3 | Home widget follow-ups (#12) | M | `src/app/page.tsx`, dashboard components, `src/lib/navigation.ts` | The only unfinished part of the dashboard work |
| 4 | Readable prose measure on wide screens | XS | `src/components/page-editor.tsx`, `globals.css` | Explicit follow-up noted when the shell went full-width |
| 5 | Self-host the Geist fonts | S | `src/app/layout.tsx`, `public/fonts/` | Removes the build's dependency on Google Fonts; already an open launch decision |
| 6 | Release mechanics: `CHANGELOG.md`, version `0.4.0`, first git tag | XS | `package.json`, `CHANGELOG.md`, docs | The release workflow tags images by SHA; the repository has nothing to point at |
| 7 | Docs refresh for the release | S | `README.md`, `docs/product-roadmap.md`, `docs/ui-feedback-backlog.md`, `docs/deployment-readiness.md` | Keep the shipped inventory honest and close the backlog |

### 1. Theme initialization (XS)

- Move the theme list and the dark-theme set into one exported module used by
  both `layout.tsx` and `theme-picker.tsx`. The inline script still needs a
  literal copy (it runs before bundles), so keep that copy beside the source
  list with a comment and a test that compares them.
- Cover it with a DOM test on the exported lists and a browser check that a
  reload in `midnight`/`rose`/`slate` paints the right background and applies
  `.dark` where it belongs.
- No storage key change: existing `kbs:theme` values stay valid.

### 2. Graph polish (#14) — bounded scope

The backlog correctly calls this open-ended. Fix the list before writing code:

- Node radius scaled by degree, with a floor and a cap so hubs do not swallow
  the canvas.
- Edge styling that distinguishes parent/child from page links from shared
  tags, and a legend that names all three.
- Labels shown for hovered and focused nodes, plus labels above a zoom
  threshold rather than always or never.
- One short mockup pass (reuse the existing `docs/mockups` pattern) to choose
  the palette and edge treatment; then implement only what the mockup settles.

Explicitly out: a new layout engine, WebGL, clustering, and animated physics
tuning. The graph stays a navigation aid.

### 3. Home widgets (#12) — the remainder

Delivered already: drag/reorder, lock, hide/restore, full/half widths, pinned
views, queues, timeline, pinned projects. Remaining, in priority order:

- ~~Saved searches as widgets, with a per-search URL so a widget row can open
  the live collection (the open question in the backlog).~~ Done in batch 4:
  `/searches/[id]` renders one collection live, and the home widget's rows link
  to it. Covered by `tests/dom/dashboard-saved-searches.test.tsx` (empty state)
  and `tests/dom/saved-search-collection.test.tsx` (missing collection, live
  count and preview).
- A smaller width step (third) only if the grid already supports it without a
  layout migration; otherwise defer. Deferred: `DASHBOARD_WIDGETS` spans are
  only `full`/`half`, so a third step is a layout change, not a config value.
- No widget registry and no new widget types in this release. Media queues are
  already reachable through pinned database views.

### 4. Prose measure (XS)

The shell and editor are intentionally full width, but body text on a very wide
monitor runs past a comfortable measure. Constrain the prose column only
(`max-width` around 68–72ch) while leaving covers, tables, embeds, and the
properties rail at full width. No layout toggle, no setting.

### 5. Fonts (S)

Replace `next/font/google` with local Geist/Geist Mono files served from
`public/fonts`, keeping the same CSS variables so no component changes. Verify
the production build succeeds with the network unavailable, and check that the
`font-display` behaviour does not shift the editor toolbar.

### 6. Release mechanics (XS)

- Add `CHANGELOG.md` with a `0.3.0` section reconstructed from the roadmap's
  "Recently completed" list, then a `0.4.0` section as work lands.
- Bump `package.json` to `0.4.0` in the release commit.
- Tag the release commit `v0.4.0`. This is the first tag; the image workflow
  keeps using the commit SHA, so nothing in deployment depends on the tag.

## Not in this release

- Multi-user identity, workspace membership, sharing, or any per-user
  isolation. Authentication alone is explicitly not sufficient.
- AI, automation, webhooks, plugins, public publishing, or a browser extension.
- A new database property type or any schema change. If an item below turns out
  to need a migration, it moves to 0.5.0 rather than growing this release.
- A visual redesign of the shell, database views, or editor beyond the two
  scoped polish items.

## Sequence

1. **Fix and unblock (1 day).** Theme initialization, prose measure, changelog
   skeleton, version bump. These are independent and land first.
2. **Fonts (half a day).** Self-host, then run the production build and the
   browser suite once to catch font-loading regressions.
3. **Graph direction (1 day).** Mockup, agree the list, then implement node
   sizing, edge styles, labels, and legend with the existing tests extended.
4. **Home widgets (2 days).** Saved-search URLs and the widget, tests for the
   live collection and the widget's empty/missing-search states.
5. **Release pass (1 day).** Full CI, docs refresh, changelog, tag, deploy, and
   post-deploy checks.

Each batch is one commit series on `main`; nothing depends on a schema change,
so any batch can ship alone if time runs short. If only batch 1 lands, that is
still a valid 0.4.0 patch-quality release.

## Acceptance criteria

- `npm test`, `npm run test:api`, `npm run test:db`, `npm run lint`,
  `npx next typegen`, `npx tsc --noEmit`, and
  `npm run check:build-warnings` pass locally and in CI.
- `npm run test:browser` passes, including the theme, graph, dashboard, and
  navigation specs touched by this release.
- A production build starts and serves a page, a database, search, and the
  sign-in gate with the new fonts and no network access to Google.
- Reloading in each of the seven themes paints the chosen palette before
  hydration; `midnight` is dark from the first frame.
- The graph renders the agreed mockup on the seeded workspace and keeps the
  small-screen page-list fallback.
- A saved search can be pinned to home and opened from its widget.
- The backlog has no open items except deliberately deferred ones, and the
  roadmap's "Recently completed" names this release's work.

### Acceptance run — 2026-11-22

On the release-pass tree: `npm test` (467), `npm run test:api` (101),
`npm run test:db`, `npm run lint`, `npx next typegen`, `npx tsc --noEmit`,
`npm run check:build-warnings`, and `npm run test:browser` (63) all pass. A
production start answers `/signin` with `200`, redirects `/` to `/signin`,
returns `401` for an unauthenticated `/api/pages`, serves
`/fonts/geist-latin.woff2` as `font/woff2`, and its HTML and CSS reference only
the local font files. One browser spec needed a fixture fix first: the chart
widget's records were pinned to November 2026 and fell out of the date axis's
rolling "past week" window once today passed 2026-11-17, so the spec now derives
both dated records from today. Remaining: the release commit and tag, the
deploy, the post-deploy checks, and the commit SHA in the changelog.

## Release checklist

1. Confirm the working tree is clean and CI is green on the release commit.
2. Confirm no new migration is pending: `npm run db:migrate` reports nothing to
   apply on a fresh database and on the production copy.
3. Update `CHANGELOG.md` and bump `package.json` to `0.4.0`.
4. Tag `v0.4.0` and push the tag with the release commit (push only when
   authorized).
5. Let `release.yml` build and deploy; the migration step must succeed before
   the app container is recreated.
6. After deploy: `/signin` answers, an unauthenticated `/api/pages` returns
   `401`, signing in shows existing pages and databases, a backup run verifies,
   and one page save round-trips.
7. Record the deployed commit SHA in the changelog entry.

## Risks and decisions

- **Graph scope** is the schedule risk. The mockup gate is what keeps it to a
  release-sized item; if the direction is not chosen in a day, ship the release
  without it and leave #14 open.
- **Home widgets** can expand into the XL registry project. The rule is: no new
  widget type unless it is a saved search.
- **Launch operations remain undecided** and are not code: hosting and database
  provider, backup retention and recovery target, and the error-monitoring
  destination. `docs/deployment-readiness.md` lists them; v0.4.0 does not block
  on them, but the release notes should say so.
- **Fonts** change first paint. If local files regress layout or the browser
  suite, revert that batch alone; it has no dependents.
