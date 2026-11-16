# UI feedback backlog

Requested changes from using the deployed build, kept in one place and ordered
easiest first. Estimates are implementation effort only (not review or deploy),
and every item was checked against the current code so the sizing is grounded.

Effort scale: **XS** under an hour · **S** half a day · **M** 1–2 days ·
**L** 3+ days · **XL** needs a design/spec before code.

## Progress

- 2026-11-15 — the scattered preference controls now live only in Settings.
  The header theme picker, sidebar collapse and sign-out shortcuts, sidebar and
  mobile navigation-editor buttons, the navigation editor's page-visibility,
  reset, and lock controls, the home dashboard's lock, reset, and hidden-widget
  controls, and the Trash backup/export/unused-file panels were removed. Home
  still owns Customize for ordering, widths, and hiding widgets; Settings owns
  their lock, reset, and restore controls. Trash keeps deleted-page recovery and
  links to Settings → Data & backups.
- 2026-11-15 — Settings is the central preferences page. Besides the workspace
  password, it now collects appearance (the same seven themes), navigation and
  sidebar controls (show database pages, collapse the desktop rail, edit or
  reset navigation, unlock a locked navigation), home layout summary with
  lock-aware hidden-widget restore and reset, database display preferences with
  a confirmation before resetting remembered views, hidden view tabs, and hidden
  entry-page properties, editor draft status with a discard action, data and
  backups (JSON export, full checked backup, backup history with per-backup
  checks, and an explicit unused-file scan before cleanup), and security (sign
  out this browser plus the password form's other-session sign-out behavior).
  Data-safety history and storage scans load on demand with retryable errors.
  Reset is unavailable while navigation or the home layout is locked. Browser
  preferences use the existing local stores, and backup/export/orphan actions
  use the existing signed-in endpoints. Covered by
  `tests/dom/settings-preferences.test.ts` for the scoped local-storage resets.
- 2026-11-15 — individual properties can be hidden on database entry pages.
  Each property row has a hide control, and the Properties heading offers a
  “Hidden properties” menu with per-property Show actions and Show all. Hidden
  ids are kept per database in this browser
  (`kbs:database-hidden-properties:<databaseId>`), so the choice follows every
  entry page in that database and survives reloads; it does not change database
  views or the underlying values. The whole-block Properties toggle still hides
  the section.
- 2026-11-15 — database entry pages can hide their properties. A Properties
  control in the record header hides the whole properties block, including its
  heading, and “Show properties” brings it back. The panel stays mounted while
  hidden, so an edit in progress is not dropped, and the choice lasts for the
  current visit. This replaces the old heading-level Collapse/Expand control
  with one header toggle.
- 2026-11-15 — the app shell and page editor use the full available width. The
  shell no longer caps content at 80rem, and the editor no longer caps itself at
  72rem, so pages and database views fill the space beside the sidebar and gain
  the extra room when it collapses. Record pages use the same full-width frame,
  so their header, properties, and page body follow it; the editor's
  contents/properties rail is unchanged. On very
  large monitors the prose column can run wide; a readable line-length limit can
  be added for body text without shrinking the page frame.
- 2026-11-15 — database views can be renamed. “Rename view” in the database's
  More menu turns the current tab into an inline field with the view name
  selected; Enter saves, Escape cancels, and clicking away also saves. The new
  name goes through the existing view PATCH endpoint, so it is stored with the
  view and appears on every surface that reads it, including embeds and the
  home dashboard's view picker. A blank name or the unchanged name closes the
  field without a request, and a failed save restores the previous name and
  reports that it could not be saved.
- 2026-11-15 — database view tabs can be hidden, and a database page reopens on
  the view you last read. “Hide view” in the More menu removes the current tab
  (including the default All records view) without deleting it; the last visible
  view cannot be hidden, and “Show hidden views” brings hidden tabs back in a
  faded style, where the active one can be unhidden. The selected view is
  remembered per database in this browser, so leaving the page and returning
  restores it. An explicit `?view=` link still wins, and a hidden remembered
  view falls back to the table view.
- 2026-11-15 — database properties have a shared visual vocabulary. Every type
  now has its own colour and icon (text slate, number sky, checkbox emerald,
  date amber, URL cyan, select violet, multi-select fuchsia, relation indigo,
  rollup purple, formula teal, file orange, button rose), and the table headers,
  record-page type badges, gallery labels, list labels, board labels, and embed
  rows and headers use it.
  Values read the way their type suggests: select and multi-select values are
  status-coloured chips, checkboxes are Yes/No pills, dates show a calendar and
  a short date, rollups and formulas carry a sigma marker, relations are indigo
  chips, numbers are tabular and emphasised, and empty cells share one muted
  dash.
- 2026-11-15 — multi-select properties now let you pick more than one choice.
  The database table and the record page both used a native `<select multiple>`,
  where a plain click replaces the selection unless you hold Ctrl/Cmd; they now
  use a checkable choice list (`MultiSelectCell`), where clicking a choice adds
  or removes it, the menu stays open for the next pick, selected choices show a
  check, and Clear or Done finish the edit. The trigger shows one chip per
  chosen value. Single-select, relation, and date cells are unchanged.
- 2026-11-15 — a one-pass backfill moves existing record pages under their
  database's central page. `npm run db:group-record-pages` walks every database,
  creates its grouping page when it does not have one (or has lost it), and
  moves its root-level record pages underneath in their existing page order,
  after any pages already grouped there. Pages a user deliberately nested
  somewhere else keep that placement, and a second run moves nothing. The
  shared `groupRecordPages()` helper accepts a database id, so the API tests
  exercise one database without disturbing the rest, and the command reports
  how many pages it moved and created.
- 2026-11-15 — a database now owns a central page, and its record pages are
  created underneath it instead of at the root of the page tree. Creating a
  database creates the page (named for the database) in the same transaction;
  every record create path — the New record button, CSV import, button actions
  that create records, the legacy page backfill on the record route, and the
  "Create linked page" action — nests its page under it. A rename of the
  database follows the page unless the page was renamed on its own. Databases
  that predate the change get their grouping page the first time a record needs
  it, and existing record pages stay where they are. A deleted grouping page
  clears the link, so the next record creates a fresh one.
- 2026-11-15 — the desktop sidebar collapses to an icon rail. A panel button
  beside the logo collapses the 14rem sidebar to a 4rem rail and back; the
  logo, search box, navigation, page and database shortcuts, and the footer
  switch to icons with tooltips and `aria-label`s, section headings and the
  page tree collapse away (a Pages icon stands in for it), and the choice is
  remembered per browser in `localStorage` through a small external store, so
  it survives navigation and reloads without a flash of the wrong state. The
  mobile layout is unchanged, and the sidebar still starts expanded for anyone
  who has not collapsed it.
- 2026-11-15 — a new record opens its page right away. Creating one from the
  database toolbar or the table's "New record" row still saves the record
  first, then navigates to the page the create request already made for it
  (`/pages/:pageId`, via the shared `recordHref`), so the title, properties,
  and page content are all editable in one place instead of leaving an
  "Untitled" row to find again. Records created from a template keep their
  current stay-in-the-view behaviour.
- 2026-11-15 — gallery views offer three card sizes. The gallery toolbar
  (database page and every database embed) gains a Card size picker: small
  tightens the grid to three or four columns with 24px covers, large drops to
  one or two columns with 56px covers, and medium stays the existing two/three
  column grid with 36px covers, so galleries saved before the choice look
  unchanged. The choice is saved as `cardSize` in the view config, so it
  follows the view across the database page, embeds, and reloads; unknown or
  missing values parse back to medium.
- 2026-11-15 — database embeds can show more than one view. When the embedded
  database has two or more views, the embed draws a compact tab strip (the same
  bordered-tab look as the database page) under its header, so a reader can
  switch between table, board, list, gallery, calendar, timeline, and chart
  views without opening the database. The view chosen in the insert picker is
  the starting tab, the current tab uses the brand underline and
  `aria-pressed`, and choosing another tab writes its id back to the embed so
  the page autosave remembers it; reopening the page returns to that view. View
  mode keeps the switch local so opening a shared page does not rewrite it. A
  single-view embed still shows the view name badge and no strip.
- 2026-11-15 — properties reorder by dragging on the record page too. Each row
  in a record's Properties section gains a grip in edit mode: drag it onto
  another property to drop in front of it, or onto the zone that appears below
  the list to move it to the end. The dragged row dims, the row under the
  pointer gets an outline, and the saved order goes through the same reorder
  request the arrows use, so drag, arrows, the database property dialog, and
  every view agree. The up and down arrows stay beside the grip as the
  keyboard and touch path, since the native drag follows the dashboard grid's
  HTML5 drag-and-drop rather than pointer events. View mode keeps no grips and
  no drop handlers.
- 2026-11-15 — properties reorder from the record page. Each row in a record's
  Properties section now carries up and down buttons in edit mode (hidden in
  view mode), which save the same database-wide column order the database's
  property dialog writes, so the record, every other record, and every view
  stay in step. The panel moves the row immediately and restores the previous
  order if the reorder request fails, using the existing
  `POST /api/databases/:id/properties/reorder`. View mode keeps the section
  read-only, and the arrows are disabled at the first and last property.
- 2026-11-15 — a date button can start from today. `today()` is now accepted in
  an expression that writes a date (`today()`, `today() + 7`,
  `today() + {Snooze days}`), and the action editor offers a “Use today”
  shortcut plus a `today() + 7` placeholder. The date is computed when the
  button runs, so a saved “set today” button writes the day it was clicked, not
  the day it was configured. `today()` is opt-in at the parser
  (`parseFormula(expression, { allowToday: true })`) and only the date button
  path asks for it, so formulas, number targets, and button creation validation
  for other types still reject it. Covered by `tests/database-formula.test.ts`
  and `tests/database-calculations.test.ts`.
- 2026-11-15 — button actions can now shift dates. A date target's expression
  reads that record's date properties and moves them by whole days
  (`{Due} + 7`, `{Due} - {Snooze days}`); number, rollup, and formula
  references still work as day counts, the result must be a date, and a blank
  reference leaves the value unwritten instead of storing a wrong date. Literal
  dates already worked; the broken part was that expressions on a date target
  were evaluated as numbers and then stringified. The shared formula language
  stays numeric, so formulas and number targets are unchanged, and the action
  editor lists date references only when the target is a date. Covered by
  `tests/database-calculations.test.ts`.
- 2026-11-15 — removed the record page's “Page content” subheader. It existed
  to separate the page body from the Properties block below it; with the
  properties now inside the editor card it labeled the only block left, added a
  rule directly above the card's own border, and duplicated the editor's
  `aria-label="Page content"`. The body region keeps its layout without the
  heading.
- 2026-11-15 — removed the record page's dead “Open standalone page” link.
  It pointed at `/pages/<pageId>`, which now resolves back to the same record
  workspace, so it only re-rendered the page it was on. The standalone page
  editor is reachable only for pages that no record owns; a record's page
  content, properties, and settings are all on the record page.
- 2026-11-15 — record properties move into the page editor. The Properties
  panel no longer sits below the page content: the record page hands it to the
  editor (`pageProperties`), which renders it above the body inside the editor
  card, so properties, quoted passage, and content read as one page. Collapse/
  Expand, view-mode locking, button cells, relation pickers, and formula/rollup
  values are unchanged, and a record that has no page yet still shows its
  properties under the loading message.
- 2026-11-13 — #12 editable home dashboard, first pass: the home page is now
  assembled from six widgets (Pick up where you left off, Today, Pinned
  projects, Timeline, Jump back in, Pinned views) whose order and hidden state
  persist per browser in `kbs:dashboard-layout`. A **Customize** toggle adds a
  drag handle, up/down arrows, and a hide action to each widget, a drop zone
  for moving one to the end, a **Hidden widgets** list with restore buttons,
  and **Reset layout**. Widget contents and their existing per-widget settings
  are untouched. New widget types and per-widget sizing are still open.
  Covered by `tests/dashboard-layout.test.ts` (normalization, moving,
  reordering, hiding) and `tests/browser/dashboard-layout.spec.ts` (customize,
  hide and reload, restore, arrows, native drag, reset). A second pass added
  five data-backed widget types — **Favorites** (starred pages), **Inbox**
  (newest captures with source and date), **Reading list** (currently
  reading, falling back to to-read), **Saved searches** (collections with
  their filters), and **Databases** (recently updated, linking to each
  database) — and a per-widget **Full/Half** width choice stored alongside the
  order. Picking the widget's default width again
  drops the override, and Reset layout clears widths with the order and hidden
  list. **Lock layout** saves the layout as locked: customize mode closes, the
  Customize action, drag handles, width selects, arrows, hide actions, and
  hidden-widgets panel all disappear, and a single **Locked** button unlocks
  it again. The lock is part of the saved layout, so it survives reloads.
- 2026-11-13 — navigation editor lock: **Lock navigation** in the editor
  footer saves `locked` into `kbs:navigation` and closes the sheet. While
  locked, the sidebar pencil and the mobile header's sliders are replaced by
  an unlock button, and the editor refuses to open. Covered by
  `tests/navigation.test.ts` and `tests/browser/navigation-lock.spec.ts`.
- 2026-11-13 — #14 graph readability pass: node radius now scales with the
  number of visible connections (capped so hubs stay readable), titles appear
  on hover and keyboard focus instead of under every node, hierarchy lines are
  dashed parent-to-child arrows while page links are solid brand lines and
  shared tags are faint dotted lines, and edges stop at the node edge rather
  than running underneath it. The legend explains the three line styles, the
  two circle sizes, and the hover behavior. A follow-up pass the same day bent
  edges into curves, coloured pages by their first tag (with a legend naming
  the tags in view) and showed every title once the zoom control passes 130%.
  A third pass gave the canvas a fixed dot grid and a soft brand glow that
  stay put while the graph pans and zooms, tinted shared-tag edges with the
  tag both endpoints share, and made title layout collision-aware: the hovered
  or centered page wins, busier pages come next, and an overlapping title is
  dropped (with long names clamped to 28 characters) instead of stacking.
  Titles now also avoid every node circle, trying above, below, right and left
  before giving up (a hovered or centered page always names itself), and each
  edge has a wide invisible hit area that reveals a tooltip on hover — the
  relation type, both page names, and the shared tag when there is one — while
  the hovered line thickens and brightens. `tests/browser/graph-focus.spec.ts`
  covers the link and shared-tag tooltips (including their removal on
  mouse-out) and asserts, from SVG bounding boxes, that zoomed-in titles clear
  every node circle and each other. Remaining for #14: only a mockup-level
  review of the overall look.
- 2026-11-14 — a record opens at its page. `/pages/[id]` now looks up the
  record that owns the page and renders that record, so the page URL is the
  record: title, page content, and the collapsible properties panel are one
  screen, and edits save through the same record endpoints. The record route
  (`/databases/[id]/records/[recordId]`) is a server redirect to
  `/pages/[pageId]`, carrying the query string so `?mode=view` still locks the
  page; records without a page yet keep the old screen, which creates the page
  when it loads. Every existing record link therefore lands on the page without
  touching the ~20 call sites that build those links.
- 2026-11-14 — formulas can build on formulas. A formula property may now
  reference another formula in the same database as well as number and rollup
  properties, so a chart or filter can read a derived value instead of
  repeating its arithmetic. The resolver already expands nested formulas and
  stops on a cycle (`referenceValue`'s ancestor set); saving is stricter than
  rendering, and a definition whose reference chain loops back on itself is
  refused with the chain shown (`A → B → A`) rather than leaving a permanently
  blank column.
- 2026-11-14 — record pages no longer repeat their connections. The page
  editor embedded in a record page appended its own “Page connections” panel
  under Details — linked pages, page backlinks, and linked records, which
  included the record the page belongs to — below the record’s own “Linked
  pages” panel at the top of the page. The embedded editor now skips that panel
  on record pages (`hidePageConnections`), while standalone `/pages/[id]` keeps
  it. The top panels still add and remove the same page/record connections.
- 2026-11-14 — record pages fold their properties into the page. The record's
  Properties panel no longer sits in its own card above the content: the page
  renders the page editor first and then the property values at the end of the
  same “Page content” section, separated by a rule, so a record reads as one
  page. The editors, button cells, and view-mode lock inside each property are
  unchanged, and the solid one-line summary above the page is gone. The
  Properties heading carries a Collapse/Expand control (`aria-expanded`,
  `aria-controls`) so a long property list stops pushing the page around; the
  editors stay mounted while collapsed, so an edit in progress is not dropped.
- 2026-11-14 — #7 button values can be expressions. A button action value may
  be `{Count} + 1` instead of a literal, so a click can raise a number without
  storing the number it will write. Expressions reuse the database formula
  language — `{Property}` references, the four operators, parentheses, and
  `round(value, digits)` — are checked when the button is saved (unknown names
  and references that are neither a number nor a rollup are rejected), and are
  evaluated on the server against the clicked record's stored values, including
  for actions that write linked records or create a record elsewhere. Buttons
  and formulas share one resolver (`evaluateRecordFormula`), so an expression
  reads exactly what a formula reads — number properties, rollups, and formula
  properties (formula references expand transitively through the formula's own
  expression, and a cycle yields no value instead of recursing) — and
  `{Total} + 1` means the same number in either place. Expression values can be written
  to number, text, url, date, and select properties; a result that cannot be
  computed (missing value, division by zero) fails the whole click instead of
  writing a blank. Values are computed inside one transaction that locks every
  record the click may write (`SELECT … FOR UPDATE`, in ID order, retried on a
  serialisation failure), so simultaneous clicks apply their expressions in
  sequence instead of both reading the same starting value.
- 2026-11-14 — record connections move into the header. **Linked from** and
  **Linked pages** no longer take a card row above the content: a compact
  **Connections** control at the end of the record's breadcrumb row (icon-only
  on phones) opens the same
  reverse-relation list and page picker in a panel below the header, closed by
  default, and closes again to reclaim the space. Adding, removing, and
  view-mode locking still go through the same endpoints; standalone pages keep
  their **Page connections** panel under Details.
- 2026-11-14 — page settings move into the page header. The settings panel
  that sat below the content is now a compact **Page settings** control beside
  Export Markdown and the favorite star (icon-only on phones), closed by
  default; Appearance, Details, tags, page connections, related pages, and
  history open directly under the page header, above the editor. Appearance,
  Details, and History each expand independently and start closed, so the
  panel opens as three compact rows; history loads when its group opens, and
  view mode still hides the control.
- 2026-11-12 — #7 programmable button properties, first action set: a
  `button` property stores a validated list of actions in
  `database_properties.options`. Each click can write one literal value to a
  writable property on the current record, on records already linked through one
  of the database's relation properties, on one existing record chosen by the
  user, or create a new record in a chosen database with a title and validated
  initial values. The server endpoint
  re-resolves every property, relation, database, and initial value, validates
  them with the normal cell rules, and writes all actions in one transaction
  with per-action result counts and created record IDs. Buttons
  render and run in table, gallery, list, board, embedded views, record pages,
  and `?mode=view`; CSV exports the button's property name. The action editor
  supports multiple actions, relation targeting, and type-appropriate values,
  and saved actions can be reopened from a button cell's settings control and
  updated through a validated property PATCH. Verified with 96/96 API tests,
  `tsc`, lint, a production build, and
  `tests/browser/database-buttons.spec.ts` (button creation with linked-record,
  searchable chosen-record, and new-record actions across
table/gallery/board/list, view mode, and embeds, including reopening and
editing the embedded button's actions).
- 2026-11-12 — #15 fully editable sidebar: named sections now hold
  destinations, the Pages tree, pinned pages, and pinned databases. Older saved
  sidebar orders migrate into a default "Workspace" section. The editor can
  create, rename, reorder, and remove sections and entries; hide toggles, the
  bottom bar, page visibility, and reset still work. Sections and entries also reorder by drag handle, with the arrow buttons kept
  for keyboard use; touch and pen drags use pointer capture and edge
  auto-scroll. The editor uses 44px controls on narrow screens, wrapping action
  groups rather than overflowing. The navigation unit suite passes 23/23, and
  `navigation-editor`, `navigation-sections`, and `navigation-mobile` browser
  specs pass 6/6.
- 2026-11-11 — #8 toolbar icons, #17 edit-navigation placement, #16 palettes,
  #13 database pages in the graph, and #1 editor link navigation implemented
  together. Verified with a production build, 413 logic tests and 131 DOM tests;
  live checks confirmed the seven palettes and the moved edit-navigation icon,
  and the editor now mounts in both dev and the standalone production server.
- 2026-11-11 — #3 rapid navigation: overlapping page transitions now resolve
  and the destination editor mounts instead of Next's "This page couldn't
  load" screen. `tests/browser/page-navigation.spec.ts` clicks through four
  pages without waiting and asserts the destination editor renders.
- 2026-11-11 — Added `app/error.tsx` and `app/global-error.tsx`. A failed
  navigation now shows a retry and a way home instead of Next's default
  "This page couldn't load" document; the route boundary clears itself when
  navigation reaches a different path. `tests/browser/global-error.spec.ts`
  forces a root-layout failure through a probe that `turbopack.resolveAlias`
  swaps in only for the browser-test build; normal builds resolve the same
  import to a no-op, so no probe code ships. The spec checks the global
  boundary renders, retries, and recovers home.
- 2026-11-11 — #6 cover: the page cover is now a full-bleed background layer
  behind the title and editor body, with a scrim and a translucent editor card
  for readability. Page settings moved below the editor so the background runs
  continuously. It bleeds to the content edges on small screens and stays
  inset from `md`; the earlier fixed-height hero is superseded.
- 2026-11-11 — #11 hideable sidebar: destinations can be hidden from the
  desktop sidebar in Edit navigation, while the bottom bar keeps its own
  selections. Hidden keys persist in `kbs:navigation`; older saved preferences
  default to none hidden. `tests/browser/navigation-editor.spec.ts` covers
  hiding and the untouched mobile bar.
- 2026-11-11 — #9 database pages: Edit navigation now owns one "Database
  pages" switch, persisted as `showDatabasePages`. The sidebar tree, `/pages`,
  home, recents, graph, and command palette all follow it; the graph's separate
  checkbox was removed so the surfaces cannot disagree. `/api/pages` now
  returns an `isRecordPage` marker alongside the existing opt-in
  `includeRecordPages` parameter. `tests/browser/database-pages-preference.spec.ts`
  toggles the switch on and off across the surfaces and checks palette results,
  and the navigation/API suites cover preference parsing and the marker.
- 2026-11-11 — #2 page icon: replaced the bare icon text field with a
  searchable, curated emoji picker that saves on selection and can remove the
  icon. `tests/dom/page-icon-picker.test.tsx` covers search, selection,
  removal, and Escape; `tests/browser/workspace-flows.spec.ts` picks an icon in
  page settings and checks the PATCH response and the icon after reload.
- 2026-11-11 — #4 gallery covers: the gallery and database embeds now fall back
  to the record page's cover when no visible file property holds an image.
  `/api/databases/[id]` and record updates expose `pageCoverImageUrl`, and
  `src/lib/gallery-cover.ts` resolves the cover for both surfaces. Page-cover
  fallbacks hide the property-remove action but keep Hide cover.
  `tests/browser/workspace-flows.spec.ts` seeds a record whose linked page has
  an uploaded cover and checks the gallery card renders it;
  `tests/browser/database-views.spec.ts` does the same for a database embed.
- 2026-11-11 — #10 view mode: record pages and database views accept a
  shareable `?mode=view` state. The record title, property editors, notes
  editor, page settings, delete controls, inline table/board/gallery cells, CSV
  import, and embedded-card edit controls are hidden or read-only; navigation,
  filters, view switching, links, and export stay usable. The mode persists
  across reloads and preserves the selected database view in the URL.
  `tests/browser/view-mode.spec.ts` toggles both surfaces and checks the locked
  and editable states.
- 2026-11-11 — #10 view mode: database and record pages have a URL-backed
  `?mode=view` toggle that survives reloads and preserves the selected database
  view. View mode hides record/database editors, property inputs, page settings,
  delete controls, and add-property/add-record actions while keeping navigation,
  linked records, backlinks, exports, and the standalone-page link usable. Page
  content and database cells render read-only. Verified with 16 navigation
  tests and `tests/browser/view-mode.spec.ts`.
- 2026-11-11 — #5 movable cover: pages now store a vertical `cover_position`
  (0–100, default 50) added by migration 0024. The page update API validates
  the range, the cover image uses it as `object-position`, and a keyboard-
  accessible drag handle in the page header adjusts and saves it. The browser
  test drags the cover, reloads, and checks both the saved value and the
  rendered image position.

### Page route fix found while verifying this batch

`/pages/[id]` stayed on its "Loading editor…" fallback in dev and in the
standalone production server, even with the committed editor. The server route
passed its `params` promise into a Suspense boundary nested inside the client
`AppShell`, and that boundary never resolved, so the editor never reached the
browser. `next/dynamic` with `ssr: false` also left a pending server boundary.

The page route is now a client page that reads `useParams()` inside its own
Suspense boundary, and `PageEditorLoader` uses `useSyncExternalStore` to wait
for the client and `React.lazy` to load the editor. Verified live: the editor
mounts, all ten toolbar icons render, and clicking a page link navigates to its
target. The database record route still uses server params, but with the
loader fix its editor now mounts as well (verified against the production
build), and the database view at `/databases/[id]` renders its table and views
without stalling. This probably also explains the "page couldn't load" symptom
in #3 when a page is opened directly.

## The list, tracked

| # | Request | Size | Where it lands |
| --- | --- | --- | --- |
| 1 | Links don't have hover and can't be clicked to navigate to other pages | S | `page-editor.tsx` (editor link config) |
| 2 | Emoji/icon picker opens when entering the icon insert | S | `page-editor.tsx` page settings |
| 3 | Navigating too quickly shows "page couldn't load, please reload" | M (diagnose first) | app routing / data loading |
| 4 | Gallery views need to show cover image | S (verify first) | `database-workspace.tsx` gallery |
| 5 | Page cover image should be movable to adjust what is shown | M | page schema + editor cover |
| 6 | Cover image should show up more in the page (maybe whole background) | S–M | `page-editor.tsx` cover block |
| 7 | Programmable buttons as a database property type | L | property types end to end |
| 8 | Undo, redo, bold, italics, lists replaced with icons | XS | `editor-toolbar.tsx` |
| 9 | Make seeing database pages toggleable | M | every listing surface |
| 10 | Database pages semi-lockable in a view mode (hide editing, buttons still work) | M–L | record page + view state |
| 11 | Some side menu sections hideable if not needed | S–M | `navigation.ts`, sidebar |
| 12 | Home page fully editable with drag-and-drop widgets | XL | `src/app/page.tsx` + dashboard |
| 13 | Allow database pages to show in the graph view | S | `graph-workspace.tsx`, `graph.ts` |
| 14 | Make the graph view more visually pleasing | L (open scope) | `graph-workspace.tsx` |
| 15 | Sidebar fully editable, organize it as I please | L | navigation model |
| 16 | Colour palettes/themes more distinct | S | `globals.css`, `theme-picker.tsx` |
| 17 | Move edit navigation out of the way, keep accessible | XS | `app-shell.tsx` |

## Ordered easiest → hardest

### 1. Toolbar buttons become icons (#8) — XS

One component. `lucide-react` is already a dependency and the same toolbar
already renders a `<Link2>` icon. Swap the eight text labels for icons, keep the
words as `aria-label`/`title`, and add a separator between formatting and
history. No API, schema or test change needed; existing queries by accessible
name keep working.

### 2. Move "Edit navigation" out of the way (#17) — XS

`app-shell.tsx` renders it as a text button directly under the destination list,
plus an icon button in the mobile header. Move it to a small sliders icon on the
"Pages" section header line (or into the footer next to Settings). The dialog,
preferences and mobile entry point stay exactly as they are.

### 3. More distinct palettes (#16) — S

Four themes exist today: Light, Dark, Warm paper, Forest. Warm and Forest are
themes of the same lightness, so they read as tints of one another. Cheap win:
add 2–3 genuinely different palettes (e.g. high-contrast midnight, cool slate,
rose) by adding token blocks in `globals.css` and entries in `theme-picker.tsx`.
The theme picker is a `<select>`, so no new UI infrastructure is needed.

### 4. Database pages in the graph (#13) — S

Half of this already exists: `/api/graph` returns an `isRecordPage` marker on
every node, and the graph page opts out with `?excludeRecordPages=true`. To
enable it: add `isRecordPage` to `GraphNode`, add a "Database pages" checkbox to
`GraphFilters`, and fetch unfiltered. The API needs no change.

### 5. Clickable, hoverable links (#1) — S

Confirmed: a link inside a page's editor, pointing at a subpage. TipTap is
configured with `link: { openOnClick: false }` in `page-editor.tsx`, so a click
only places the caret and the subpage never opens. The fix is contained:

- Treat a click on a page link (`/pages/<id>`) as navigation, unless the user is
  dragging out a text selection.
- Keep `Ctrl`/`Cmd`-click and middle-click working for a new tab.
- Give `.tiptap a` a real hover state in `globals.css`; the underline is always
  on today, so there is nothing that changes on hover.
- Keep the Link toolbar for creating and removing links, and keep the recorded
  page connection intact — navigating must not unlink the pages.

Only the editor and one CSS rule change; no API or schema work.

### 6. Cover takes more of the page (#6) — S, then M for full background

The cover is currently a fixed `h-36 sm:h-44` strip with `object-cover`.
Raising the height (and scaling it with viewport) is a one-line change. A
full-bleed background behind the title and body is a layout change to the page
shell and is best done after #5 (movable cover), since both touch the same block.

### 7. Emoji/icon picker (#2) — S

The icon is a bare text input (`maxLength={8}`) in Page settings. Replace it with
a button that opens a small curated emoji grid with search, reusing the existing
dropdown/tooltip primitives. No new dependency is required for a good curated
set; a full picker library is optional and would be the main scope increase.

### 8. Hideable side menu items (#11) — S/M

Ordering is already persisted per device (`kbs:navigation`), but every
destination is forced to remain visible by `normalizeSidebarOrder`. Add a
`hidden` list to the preferences, filter it when rendering the sidebar (not the
mobile bar), and add a show/hide toggle per destination in the Edit navigation
dialog. Small, self-contained, and it pairs naturally with #17.

### 9. Gallery covers (#4) — S, but verify the case first

Gallery cards already render a cover from visible **file** properties, with a
"Cover image" property selector and a per-record hide control. If their gallery
shows no cover it is almost certainly because the images live on the record's
page cover or on a property that is hidden/non-file, and the current fallback
only scans file properties. Confirm the database and then add the missing
fallback (page cover image) — that is a contained change in
`database-workspace.tsx`.

### 10. Rapid navigation error (#3) — M, diagnosis-heavy

There is no string like "page couldn't load, please reload" in the app, and there
is no `app/error.tsx` boundary, so a thrown render error falls through to
Next's default error screen. Two plausible causes to separate: a client fetch
rejecting when a navigation aborts it (each view has its own "Could not load…"
state), or a stale render after fast route changes. The fix is likely small
(abort-aware loads, ignore results after unmount, add an `error.tsx` with retry),
but the reproduction and the server/client logs are the real work.

### 11. Movable cover image (#5) — M

Needs persisted focal position, which does not exist: the page row has
`cover_image_url` only. Add a `cover_position` value (a vertical percentage is
enough), migrate, extend the page PATCH schema, apply it as `object-position`,
and add a drag handle over the cover. Touches schema, API, editor and tests, so
it is a real (if contained) feature rather than a restyle.

Implemented 2026-11-11: `cover_position` defaults to 50, PATCH accepts integers
0–100, and the header handle supports pointer dragging plus arrow/Home/End keys.

### 12. Database pages toggle, everywhere (#9) — M

Confirmed: one switch for seeing record pages across the Pages section, the
sidebar tree, home, the graph, recents — every listing surface. Today the
behaviour is inconsistent rather than switched: `/api/pages` hides record pages
by default (`includeRecordPages=true` opts back in), the graph used to opt out
on its own, while recents and the command palette already include them. Making
one preference authoritative:

- Persist a `showDatabasePages` choice (the `kbs:navigation` localStorage
  pattern) and expose it in the Edit navigation dialog once #11 lands.
- Return an `isRecordPage` marker from `/api/pages` (the graph route already
  computes one) so client-side lists can filter without guessing.
- Apply it to the sidebar tree, `/pages`, home's resume/recent cards, recents,
  the command palette, and the graph's node set.
- Default off, which matches today's hidden behaviour.

Several surfaces, one flag: no migration, but a shared helper is needed so the
flag cannot drift per screen.

Implemented 2026-11-11 for the sidebar, Pages, home, recents, graph, and command
palette.

### 13. Semi-lockable record pages (#10) — M/L

No read-only or lock concept existed; cell editors were always live. A view
mode needs a mode toggle (URL or saved state), a read-only record page that
hides property editors and the notes editor, inline cell editing disabled in
database views while in view mode, and explicit exemptions for action-style
controls. That last part only means something once #7 (programmable buttons)
exists, so this is the natural follow-up to it.

Implemented 2026-11-11: `?mode=view` is URL-backed on both database and record
pages, and the read-only state is shared with the page editor and embeds.

Implemented 2026-11-11: `?mode=view` is the URL-backed lock. Record pages render
read-only titles and property values, hide their delete action and page-settings
editor, hide the notes toolbar and page-settings panel, and keep record/page
links usable. Database table, gallery, and board views disable inline editing,
creation, deletion, CSV import, and embedded-card mutations while keeping
filters, view navigation, links, and exports. `PageEditorLoader` now accepts
`readOnly`, and the page editor passes that state to embedded database cards.
`tests/browser/view-mode.spec.ts` covers the toggles, reload persistence, and
read-only inputs.

### 14. Fully editable sidebar (#15) — L

Implemented 2026-11-12 with named custom sections. `kbs:navigation` now stores
`sections`, each with a name and ordered entries for destinations, the Pages
tree, pinned pages, and pinned databases. Older preferences derive one
"Workspace" section from their saved `sidebar` order plus the Pages tree, so
saved layouts keep working. The editor creates, renames, reorders, and removes
sections; adds, moves, and removes entries; and keeps the existing   hide/show
  toggles, bottom-bar picker, database-pages switch, and reset. The renderer fetches
  current page/database titles for pins rather than storing stale names, filters
  hidden destinations, and renders the Pages tree where its entry sits. Sections
  and entries reorder by dragging their handles, including entries dropped onto
  another section's header; arrow controls remain for keyboard use. Mouse drag
  uses native HTML5 events, while touch and pen use pointer capture with
  hit-testing and edge auto-scroll in the scrollable editor. On narrow screens
  controls are 44px and section/entry action groups wrap instead of shrinking
  their labels; `navigation-mobile.spec.ts` checks Pixel 5 and Galaxy S9+ for
  minimum touch targets and no horizontal overflow.
  `tests/navigation.test.ts` covers the model and
  `tests/browser/navigation-sections.spec.ts` covers building a section, pinning a
  page and database, moving the tree, reload persistence, dragging a section and
  an entry into a new order, and section removal.

### 15. Programmable buttons as a property type (#7) — first pass delivered

Notion-style button properties now exist. A `button` type registers with the
normal property API and add-property form. Its `options.actions` array is
validated at creation and on every edit, and each click posts the button
property to `/api/databases/[id]/records/[recordId]/button`. A settings control
on each button cell in table, gallery, board, list, record, and embedded views
reopens the action editor with the saved actions, so changing a button
does not mean deleting and recreating the property. Embedded controls honor the
embed's read-only context. `PATCH
/api/databases/[id]/properties/[propertyId]` merges the new action list into the
property's existing options and re-runs the same target and value validation as
creation.

Delivered action vocabulary:

- `set_property` writes a literal value to a writable property on the current
  record.
- `set_related_property` writes a literal value to a writable property on the
  records already linked through a relation property on this database.
- `set_record_property` writes a literal value to a writable property on one
  existing record chosen by the user. The editor loads the chosen database's
  records and properties, filters the record list by title as the user types,
  highlights matching text, and keeps the current selection available. Arrow
  keys move through the list, Enter selects, and Escape clears the search. The
  server checks that the record and property both belong to that database. A
  button can target its own record this way.
- `create_record` creates one new record in a chosen database with a required
  title ("Untitled" by default) and literal initial values. The new record owns a
  linked page just like a normally created record, and the action result includes
  its ID.

Editing is limited to button properties; other property types are refused, and
the route only accepts the action list rather than arbitrary option changes.
Targets are limited to text, number, checkbox, date, URL, select, and
multi-select properties. Relation, rollup, formula, file, and button targets are
rejected for current, linked, chosen-record, and initial-value writes. The endpoint re-resolves all
databases, relations, and properties, validates each value with the normal record
rules, and writes in a transaction, returning one result per action with an
affected-record count. Renderers cover table, gallery, list, board, record pages,
embedded views, and view mode; CSV exports the button label.

The action vocabulary now covers current, linked, chosen-record, and
new-record writes with literal values. Any future action that needs expressions,
arbitrary record IDs, or extra state should still be specified and tested
separately rather than widening this endpoint blindly.

### 16. Graph visual polish (#14) — L, open scope

The graph is a hand-rolled SVG force layout with zoom/pan, node dragging, tag /
group / favorites filters and a list fallback. Styling edges (curves, hierarchy
vs. link differentiation), node sizing by degree, labels on hover/zoom, and a
colour legend are all achievable incrementally, but "more visually pleasing" has
no finish line until a direction is chosen. Suggest a short mockup pass, then
implement the agreed list.

### 17. Fully editable home page with draggable widgets (#12) — XL

The home screen is a fixed composition of six sections (resume cards, queues,
pinned projects, timeline, recent pages, pinned views). Editable drag-and-drop
widgets require a widget registry, per-widget configuration, a persisted layout,
drag-and-drop reordering (and probably resizing), plus fallbacks when a widget's
data source disappears. This is the largest item on the list and builds on the
navigation-preferences pattern rather than replacing it.

## Suggested batches

1. **Polish batch (a day):** #8 icons, #17 move edit navigation, #16 palettes,
   #13 database pages in the graph.
2. **Linking bug first:** #1 links (reproduced and understood), then #4 gallery
   covers (after checking the database), #6 cover size, #2 emoji picker.
3. **See what I want:** #11 hideable nav items and #9 database-pages switch
   (they share the Edit navigation dialog), then #5 movable cover.
4. **Bug first:** diagnose #3 with server logs before scheduling it, since it
   may be a small fix or may need a loading-model change.
5. **Larger projects, in order:** #7 programmable buttons → #10 view mode →
   #15 sidebar model → #14 graph polish → #12 home widgets.

## Answered / still open

Answered:

- #1: the page editor, following a link to a subpage.
- #9: everywhere — Pages, home, graph, recents, every listing surface.
- #7: Notion button parity, including editing values on the same record or
  another page.

Still open:

- #7: the exact action list, and whether cross-page writes go through a relation
  or an explicit page picker.
- #12: whether more widget types (media queues, a tag cloud) and finer
  sizing than Full/Half are worth adding, and whether saved searches should
  gain per-collection URLs so a widget row can open one directly.

