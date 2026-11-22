# Changelog

KBS records its own releases here. The version matches `package.json` and each
release is tagged `vX.Y.Z` (image builds are still identified by commit SHA).
Entries describe what someone using the app can do, newest first.

## [0.4.0] — 2026-11-22

A polish-and-confidence release: no schema change, no new data model, and no
new widget types. Scope and sequencing are in
[the release plan](docs/release-plan.md).

### Fixed

- Choosing **Slate**, **Rose**, or **Midnight** no longer flashes the default
  palette while the page loads. The pre-hydration script now takes its allowlist
  and its dark-theme set from the same list the picker uses, so all seven themes
  paint before React hydrates, and **Midnight** is dark from the first frame.

### Added

- Every saved search has its own address (`/searches/<id>`), so a row in the
  home **Saved searches** widget opens that collection directly instead of the
  list. The collection is recomputed on every visit — its count, its preview,
  and an **+N more** link that carries its filters into the page browser — and a
  collection deleted elsewhere explains that it is gone rather than failing.

### Changed

- Body text in the page editor keeps a readable measure (72 characters) on wide
  screens, while tables, images, embeds, and the page frame stay full width.
- The knowledge graph highlights relationships on hover: pointing at or focusing a
  page names it and brightens every line attached to it, so a hub's
  neighbourhood reads without clicking. Its legend is grouped by relations,
  node size, and tag colours, with the interaction hint on its own line.
- Geist and Geist Mono are served from the app (`public/fonts`, SIL OFL 1.1)
  instead of being downloaded through `next/font/google`, so the production
  build and offline use no longer depend on Google Fonts. The CSS variables and
  rendered typography are unchanged.

## [0.3.0] — 2026-11-15

The state of `main` at the end of the 0.3.0 cycle. The repository has no earlier
release tags, so this section is reconstructed from
[the roadmap](docs/product-roadmap.md) rather than from a tag.

### Added

- Database **chart** views: labelled horizontal bars, a pie for share of total,
  and a line following record order or a date axis, each with grouping by a
  select property, date windows, and counts for records left outside the view.
- Database **list** and **timeline** views. A list flattens a view's visible
  properties into one row per record; a timeline groups records by a date
  property across a 7-, 30-, or 90-day horizon and keeps undated records
  visible.
- **Saved searches** as live collections that rerun their page filters on every
  visit instead of storing rows.
- A **reading list** with to-read, reading, and finished states, a notes page for
  every item, and passages with optional notes.
- A **focus view** that gathers a project's task lists into one checkable list,
  writes each check-off back to the page that holds it, and lists the project's
  subpages and related pages and records.
- Graph filters by **tag**, **page group**, and **shared tags**, with a
  favorites-first page list replacing the canvas on phones.
- An **Unconnected** view of pages and records with no links, tags, hierarchy, or
  relations.
- Explainable **related-page suggestions** ranked by shared records, link
  targets, and tags, with an explicit **Link** action.
- **Record pages**: a record and its page are one document, with editable
  properties under the page body, and renaming either keeps both titles in step.
- Relations that can be followed from either end, with a searchable relation
  picker and a **Linked from** section.
- Page-to-record **connections** managed from either side.
- A **chart widget** on the home dashboard that keeps its saved shape and
  supports explicit date ranges with month presets.
- Home **timeline** merging every database's dated records into one chronology,
  plus **due soon** and **current projects** queues configured from a database
  and property.
- **File, image, and PDF capture** in the inbox, saved-link **quotes** for the
  text selected when capturing, and Open Graph previews with title, description,
  site name, image, and favicon.
- **Page templates**, including the built-in decision journal and project
  kickoff.
- **Backups** with `npm run backup`: a dated folder with `workspace.json`, every
  attachment, and a checksummed manifest, verified each run, plus backup history
  and an explicit unused-file scan in Settings.
- **Formula properties** over numbers, rollups, and other formulas, validated on
  save.
- **CSV import** into an existing database and **Markdown** import as pages,
  including a folder tree and its embedded files.
- Per-view **property visibility**, view duplication, and saved tab order.

### Changed

- **Settings** is the single preferences page: appearance, navigation and
  sidebar, home layout, database display, hidden properties, editor drafts,
  backups, and the workspace password all live there.
- Individual properties can be **hidden on entry pages**, per database, without
  changing the database or its views.
- Database views can be **renamed** and their tabs **hidden**, and a database
  reopens on the view last read.
- Database properties have a shared **visual vocabulary** with a colour and icon
  per type, and values read the way their type suggests.
- The app shell and editor use the **full available width** rather than a fixed
  maximum.
- The **editor** gained drag-and-drop block reordering, multi-block moves with
  `Alt+Shift+↑/↓`, an accessible name and shortcut, a title-to-body handoff, and
  caret placement from the outline.
- Editor **save state** is explicit: unsaved, saving, saved with age, and failed
  with retry, plus a warning before leaving with pending edits.
- The editor is usable on **phones**: touch-sized controls, a sticky toolbar,
  menus that stay above the keyboard, and property fields that do not overflow.
- **Backlinks** show a count and the sentence around each inline link.
