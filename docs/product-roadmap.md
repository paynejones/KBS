# Product roadmap

This roadmap describes KBS as a self-hosted personal information system: a place to write, collect, connect, and act on personal knowledge. “Notion parity” is not the product goal. The priority is a coherent, fast experience built around the user's information and the relationships between it.

## Product direction

- Keep KBS useful as a single-user app first.
- Treat pages, databases, tasks, and files as parts of one connected information system.
- Favor quick capture, reliable retrieval, and easy navigation over feature count.
- Keep multi-user collaboration on the roadmap, but defer it until a real need arises.
- AI and automation are future possibilities, not current milestones.

## Current foundation

The app already includes nested pages, a rich-text editor with slash commands and wiki-style `[[page]]` links, page reordering and moving, favorites, tags, explicit page links and backlinks, a Ctrl/Cmd+K command palette over search and navigation, recent pages, trash with restore and permanent delete, a full workspace JSON export with a restore script, recoverable local drafts with recover/discard, Markdown import/export helpers, page icons and remote or uploaded covers, page revision history, and databases with table, board, gallery, calendar, list, timeline, and chart views, where every record owns a full page that shows its properties and page content together. Views store their own structured filters and multiple sort rules, and any saved view can be pinned as a home dashboard widget. Database properties include text, number, checkbox, date, URL, select, multi-select, file/media, relation, rollup, and formula. Databases can be embedded in pages, use record templates, and export as CSV or JSON. Pages and records can be connected in both directions, and an Unconnected view surfaces pages and records with no links, tags, hierarchy, or relations. A workspace graph shows page links and parent/child structure, including a local neighborhood view, edge-type and favorite filters, and a page list on small screens. An inbox supports quick capture of notes and URLs, reading each captured page's title, description, site name, preview image, and favicon so saved links arrive recognizable, and lets a saved link keep the passage you quoted from it.

This is a code-level inventory, not a claim that every feature has the same polish or breadth as its Notion equivalent.

## Recently completed

- Added a chart view for numeric data. A **Chart** view picks a Number, Formula, or Rollup property and draws its values as labelled horizontal bars, largest first, with every bar opening the database filtered to the records behind it, with a return link to the chart (or back to the home dashboard when opened from a pinned widget); choosing a Select property sums the values per choice instead, so a grouped comparison stays readable and its bars filter by that choice. The view shows at most twelve bars, reports how many records it left out and how many have no number, and saves the value and grouping choices with the view. The same data can be shown as a **Pie** — share of total, with zero and negative values left out instead of drawn as misleading slices, and each slice opening the same filtered database, with bar and slice links on the dashboard keeping the chart's active date window, their totals limited to it, the same date controls visible for every shape, a one-click Clear in the range summary to remove the window from dashboard widgets or database chart views, a count of the records left outside the window that opens the database filtered to them, a per-slice outside count on grouped bar and pie charts, with each bar row and pie legend count linking to that group's excluded records, and a compact note naming groups whose records all fall outside the window, with each group linking to its excluded records — or as a **Line** that follows the view's saved record order for up to 24 points, with a low/high readout and an expandable value list. A line can instead use a Date property as its x-axis: points sort chronologically, sit at their real dates, and records without a date are counted rather than plotted. A date-axis line also takes a rolling window — the next 7, 30, or 90 days with the past week kept, like the timeline — counts the records it leaves outside, and can step the window back by its own span, with a Today reset, to review earlier periods, or take an explicit From/To range that replaces the rolling window; This month and Last month presets fill that range, keep following the calendar, and show the dates and record count they cover; hand-picked ranges show their span and count too, and the count links to the database filtered to those records. The chosen shape, value, grouping, and line date axis and window are saved with the view.
- Rendered saved list, timeline, and chart views inside embedded database blocks. An embed now draws the view it names instead of falling back to a table: a list keeps the view's filters, sorts, visible properties, and calculated values, a timeline keeps its date property and horizon, and a chart keeps its value and grouping choices, with those choices saved back to the same view. Each stays inside the embed's compact frame.
- Added list and timeline views to databases. **List** flattens a view's visible properties into one scannable row per record, resolving calculated values as the table does and leaving blank values out. **Timeline** groups a database's records by a chosen date property into day sections, keeps a week of recent history before a 7-, 30-, or 90-day horizon chosen in the view, counts the records the window leaves out, and keeps undated records visible. Both views inherit the view's filters, sorts, and visible properties, and can be duplicated or reordered like any other view.
- Made the knowledge graph filterable and usable on phones. Page links and parent/child edges can be hidden independently and the graph can keep only favorite pages, with the page count and edge list following the active filters while the center-page and depth controls still narrow the neighborhood. Below the desktop breakpoint the canvas gives way to a favorites-first page list that respects the same search and filters.
- Suggested related pages from connections the workspace already holds. A page's Details section proposes up to five pages, ranked by shared database records, shared link targets, and shared tags, and each suggestion names the specific records, links, or tag names behind it instead of showing an opaque score. Pages that are already linked, inbox captures, and record pages are left out, and nothing is connected automatically: **Link** creates the connection and dismissing a suggestion only hides it for that visit.
- Made the editor's focus and selection behave while writing and moving blocks. `Alt+Shift+↑/↓` now moves the block around the caret at any depth instead of only at the top level — a list item inside its list, a paragraph inside a quote, or the wrapping block when it is an only child — and keeps the caret's offset and direction inside the moved block, while a selection spanning several blocks moves them as one group with the selection still over the same text. Table rows and cells are refused. Enter in the page title hands focus to the start of the body, choosing a heading in the page rail places the caret in that heading instead of only scrolling to it, and the editor exposes its name and move shortcut to assistive technology. The move itself is a pure helper with its own tests. Dragging the block grip with a multi-block selection moves the same group: the handle's single-block drag is replaced with the covered range, so the drop removes and reinserts exactly the blocks the shortcut would move, and the drag ghost previews the whole group rather than the hovered block, with list markers, callout styling, and block spacing intact.
- Merged every database's dated records into a home timeline. The section groups entries by day (naming today, tomorrow, and yesterday), keeps the past week visible before a 7-, 30-, or 90-day horizon chosen in place, and shows each record's database and date property beside its title, so tasks, milestones, and dated notes share one chronology without setup.
- Let a relation be followed from either end. A record's **Linked from** section lists the records whose relation properties point at it, showing each source database and property name and linking straight to the source record, so the far side of a relation is no longer a dead end.
- Replaced the relation property's multiple-select in record pages with a searchable picker. Linked records show as chips that unlink in place, adding one searches the target database instead of scrolling a list, the list is keyboard navigable, and a link whose record was deleted still shows as a removable chip.
- Gave database views their own layout controls. The Properties menu beside the view filters shows how many properties a view displays and hides or restores each one without touching the database or its other views; the table, gallery, and embedded database blocks honour the choice, and an untouched view still shows everything. A view can also be duplicated — the copy keeps its type, filters, sorts, grouping, date property, and visible properties, opens immediately, and lands beside its source — and moved left or right, with the whole tab order saved in one request so duplicated and reordered views survive a reload.
- Turned the home page into a daily landing page with two queues built from existing records. **Due soon** lists records from a chosen database whose date property is overdue or within the next week, sorted by date and flagged by urgency, with an overdue count, finished statuses left out, and an explicit choice of which status property marks a record finished (or no status filter at all); **Current projects** lists records whose status has not left the queue, most recently updated first, and can skip a chosen set of status values instead of relying on the built-in done vocabulary. Both are configured with a database and property picker on the home page, remember the choice per browser like pinned views, explain their empty, unconfigured, and deleted-source states, and remain views over the underlying records rather than copies.
- Let the inbox keep a file, not just its address. Captures now accept one image or PDF up to the attachment limit: the file is stored through the existing attachment route, the inbox card shows an image preview or a named file row with its size and an open action, and the capture becomes a normal page whose body embeds the image or links the file. Moving the capture into Pages or a database keeps the file with it, and the orphan scan counts the capture as a reference so cleaning up unused files never deletes it.
- Let a saved link keep the passage you meant to remember. Capturing a URL now accepts optional selected text, stored on the page beside its source and shown as a quote above the link's preview in the inbox. The quote stays with the item when it is moved into Pages and is shown again above the body when that page is opened, where it can be corrected or removed in place.
- Connected pages and database records in both directions. A page's connections panel lists the records it is linked to, a record shows the pages linked to it, and either side can add or remove the same connection, which is stored once and disappears when either end is deleted. The new Unconnected view lists active pages with no parent, children, tags, page links, or record links, and records with no relations or page links, so unconnected material can be found and either connected or removed.
- Let the inline link control target pages, not just web addresses. Typing a title in the Link panel lists matching pages, arrow keys and Enter choose one, picking a page writes a `/pages/<id>` link and records the connection so backlinks see it, and reopening a page link shows the page's title instead of its path.
- Applied the home, navigation, and mobile screens from the UI redesign deck in `docs/mockups/ui-redesign.html`. The home page now leads with a dated greeting and a “Pick up where you left off” card row, then shows a two-column canvas of recent pages and pinned views with colour-coded status pills. The sidebar is tighter with a brand-tinted active destination, the phone layout uses four 48px bottom-bar destinations with a search field in the header and a floating capture button, and the navigation editor opens as a bottom sheet on phones. An indigo `--brand` token per theme keeps interaction colour separate from status colour.
- Gave database records full pages: creating a record now creates its page in the same transaction, older records get one when opened, and `/databases/[id]/records/[recordId]` shows editable properties above the page editor. Renaming either the record or its page keeps both titles in step, and record pages stay out of the page tree, `/pages` list, command palette page results, the home page's Jump back in list, and the knowledge graph with its center-page picker while remaining directly openable.
- Made saving legible: the editor now says “Unsaved changes” while an edit is waiting for its debounce, “Saving…” while the request is in flight, and “Saved 2m ago” once it lands, with the exact timestamp on hover and a red “Save failed” alongside the retry action. Leaving the page with pending edits asks for confirmation instead of silently dropping them.
- Made the editor usable on phones: formatting controls are larger touch targets and the toolbar stays at the top of the screen while scrolling, the slash and page-link menus stay inside the shrunken visible area when the on-screen keyboard is open and scroll internally instead of being cut off, and page-property fields no longer overflow a narrow screen.
- Made URL captures richer: saving a link now reads the page's Open Graph and Twitter metadata — title, description, site name, preview image, and favicon — and stores it with the capture, so the inbox shows a real preview card instead of a bare hostname. The server only fetches public HTTP(S) addresses, re-checking every redirect, with a byte cap and timeout, and a capture still succeeds when the page is offline or unreadable.
- Added formula properties: a computed column written as an expression over other properties, such as `round({Episodes watched} / {Episodes total} * 100, 1)`. Formulas read number and rollup values, support arithmetic, parentheses, and `round()`, and are validated on save so a mistyped or missing property reference is rejected rather than rendering a wrong number.
- Added drag-and-drop block reordering: hovering a block reveals a grip that moves it to a new position, alongside the existing Alt+Shift+↑/↓ keyboard moves.
- Added page templates: save any page as a reusable structure, or start with the built-in decision journal and project kickoff. Creating a page from a template copies its title, icon, and content in one step, and the page and template stay independent afterwards.
- Added an inline link control to the editor for external URLs, with selection-aware apply/update/remove.
- Added home dashboard widgets: any saved database view can be pinned to the home page, and each widget applies that view's filters and sorts to a short record preview. A pinned **Chart** view keeps its saved shape — bars, pie, or line — and draws it from every record the view includes rather than the five-record preview, resolving formula and rollup values the way the database page does and keeping the same labels, percentages, bounds, and skipped-record notes. The widget's shape, value property, Select grouping, and line date axis and window can be switched in place, the window can step back over earlier periods and return to today, an explicit From/To range can replace the rolling window, with This month and Last month presets that stay on the current or previous month and show their dates and record counts, as do hand-picked ranges; each choice saves back to the shared view, and a value, grouping, or date change redraws from the dashboard's refreshed data so the database page and every other widget follow it.
- Added a calendar view for date properties, with month navigation, today highlighting, a date-property switcher, and a list of undated records.
- Added structured, per-view filters and multiple sort rules. Filters use type-aware operators (contains, is before/after, greater/less than, is empty, is checked) and apply to every view type, with the old quick search kept alongside them.
- Backlinks now show a count plus a quoted snippet of the sentence around each inline link, so a mention can be judged without opening every source page.
- Added a trash: deleting a page moves it and its subpages there, with restore and permanent delete. Trashing preserves tags, links, and revisions; permanent delete removes attachments that nothing else references.
- Added unused-file detection and cleanup, plus a full workspace JSON export and a `npm run restore:export` restore path documented in [backup and restore](backup-and-restore.md).
- Added a command palette (Ctrl/Cmd+K) that searches pages and database records, jumps to favorites and recent pages, opens common destinations, and creates pages or databases without leaving the keyboard.
- Added recent pages: visits are recorded per browser, shown on the home page as “Jump back in”, and offered at the top of the command palette.
- Added a workspace graph view for navigating page connections, including a local graph with neighborhood depth, zoom, pan, drag, and node search.
- Added an inbox for quick notes and URLs, with page/database organization, saved-link previews, and capture timestamps.
- Added quick capture from the workspace header and mobile navigation, with a keyboard shortcut.
- Added editor slash commands, keyboard shortcuts, common block types, and wiki-style `[[page]]` autocomplete. Inline page links use stable page IDs, and new targets can be created from the autocomplete menu.
- Added page icons and covers, page revision history with restore, and explicit recover/discard for local drafts.
- Added database record templates.
- Added uploaded attachments for page content, covers, and database file/media properties, including gallery card covers, alt text, and visible load failures.

## Parity with the current personal workspace

KBS does not need broad Notion feature parity. It should be able to represent the workflows already in use in the user's Notion workspace: a home dashboard for tasks and projects, media libraries for anime, manga, movies, series, and games, release and progress tracking, and pages for game development and story ideas.

The following gaps are specific to those workflows and should guide the existing priorities below:

- **Media presentation:** page icons, covers, uploaded or linked images/files, and image-backed gallery cards are in place, and inbox captures keep their image or PDF.
- **Page and web links:** keep page links and backlinks, add inline link creation while writing, and make linked pages easier to scan in context. Support saving an external URL with its title, description, source, and optional selected text, with a useful preview and a direct open action.
- **Home dashboard:** allow configurable widgets for saved database views and useful queues, including tasks due soon, current projects, currently watching/reading/playing, and selected media or hobby views. Include quick actions for common capture and record creation. Widgets must remain views over existing records.
- **Calendars:** add calendar views for tasks and dated media releases, with useful date filters and named views. A record's release date or a task's due date should be visible from both its database and the home dashboard.
- **Status and progress:** make named, filtered views practical for workflows such as watchlist, currently watching, waiting, finished, dropped, backlog, and top rated. Add formulas and progress indicators so episode/chapter counts and project/task completion can surface as percentages or rollups where the underlying data supports them.
- **Creative project flow:** make it easy to connect story and game ideas to a project, its tasks, and related reference pages, so an idea can move into active work without being copied between separate lists.

These are acceptance goals for the relevant roadmap items, not a requirement to reproduce every Notion feature or recreate the current workspace's data model exactly.

## Near-term priorities

### 1. Make the editor feel complete

Writing and shaping a page should feel natural. Media handling is no longer the blocker.

- [x] Add slash-command insertion and keyboard shortcuts for common blocks and formatting.
- [x] Add practical block types: task lists, code blocks, tables, callouts, toggles, dividers, and image embeds.
- [x] Add page icon and cover support, with clear loading and failure states for media.
- [x] Add image and file support that works in page content and database gallery cards; allow remote images as well as uploaded media, with alt text and visible error states.
- [x] Preserve reliable draft recovery and add an explicit way to recover or discard a recovered draft.
- [x] Support drag-and-drop or other direct block reordering, with predictable selection and undo behavior. Keyboard block move already exists.
- [x] Make the editor usable on phones: touch-sized formatting controls, a toolbar that stays reachable while scrolling, and slash/page-link menus placed inside the visible area above the on-screen keyboard.
- [x] Show save state clearly: distinguish unsaved edits, an in-flight save, a recent successful save with its age, and a failure with retry, and warn before leaving with pending changes.
- [x] Improve editor focus and selection while writing and moving blocks. Block moves with `Alt+Shift+↑/↓` work at any depth and preserve the selection, including moving a multi-block selection as one group; the title hands focus to the body on Enter; outline headings take the caret; and the editor carries an accessible name and shortcut.

### 2. Build a connected knowledge graph

Add an Obsidian-style connection map that makes page relationships visible and navigable.

- [x] Provide a workspace graph showing pages as nodes and links as edges.
- [x] Provide a local graph centered on the open page, with controls for neighborhood depth.
- [x] Support zoom, pan, drag, node search, and opening a page from its node.
- [x] Distinguish explicit links from parent/child structure.
- Optionally show shared tags as a separate relation.
- [x] Offer useful empty and dense graph states, plus filters for link type and favorites. Page links and parent/child edges hide independently, favorites-only keeps the graph to starred pages, and the empty state says which filters caused it.
- [x] Keep graph navigation usable on smaller screens and offer a list-based alternative. Phones get a favorites-first page list in place of the canvas, with the same search, filters, and neighborhood scope.
- Add tag and page-group filters to the graph.

KBS already stores explicit links and backlinks, so those can seed the graph. Graph rendering should remain a navigation aid: the existing tree remains the clearest way to manage hierarchy.

### 3. Make page linking and capture faster

This is the current top product priority after media: jump, create, and connect without leaving the keyboard.

- [x] Add wiki-style `[[page name]]` linking with autocomplete and link creation. Links use stable page IDs so renaming a page does not break its destination.
- [x] Add a quick capture action that creates an inbox page without requiring the user to choose a destination first.
- [x] Make backlinks easier to scan, with a count and a quoted snippet of the sentence where each inline link appears.
- [x] Add an inline link control for external URLs and pages, with page-name autocomplete; keep the existing page-connections panel for managing relationships and backlinks.
- [x] Add a command palette for creating pages/databases, jumping to favorites and recent pages, and common navigation actions. It owns Ctrl/Cmd+K, replacing the previous search-only overlay.
- [x] Add recent pages for quick return paths. Visits are stored per browser, surfaced on the home page as “Jump back in” and at the top of the command palette, and kept separate from the server-driven recently-updated list.
- Extend the palette with more actions, such as saved views or inbox capture, and make recents follow the user across devices if that becomes useful.
- [x] Add page templates for repeatable note structures, including starters for a decision journal and project kickoff.

### 4. Add a universal capture inbox

Make it easy to save something now and organize it later.

- [x] Add a dedicated inbox for quick notes, ideas, and URLs.
- [x] Let captured items become regular pages or database records without losing their source or capture date.
- [x] Render saved links as compact previews that show the title and source and open the original URL directly.
- [x] Store a saved link's title, address, description, site name, preview image, and favicon.
- [x] Store optional selected text alongside a saved link, so a quote stays attached to its source and shows above that link's preview in the inbox.
- [x] Add file, image, and PDF capture now that attachment storage and previews are in place.
- Consider a browser extension as a later companion to the core inbox, not a prerequisite.

### 5. Make relationships useful across the system

- [x] Let pages link to database records and show the connection from both sides: a page lists its records, a record lists its pages, and either side can add or remove the same connection. Records still reach one another through relation properties.
- [x] Make relation fields easier to navigate in both directions, with related items visible from the relevant page or record. A record shows its linked records as removable chips and adds one from a searchable list, and a **Linked from** section lists the records whose relation properties point at it, with the database and property that connect them and a link straight to that record.
- [x] Add related-page suggestions based on existing explicit links, shared tags, and shared relations. Keep suggestions explainable and optional; defer semantic/AI suggestions. A page's Details section lists up to five suggestions, each naming the shared tags, link targets, or records behind it; connecting one is an explicit action and dismissing it only hides it for that visit.
- [x] Surface orphaned pages and records that have no meaningful connections. The Unconnected view lists pages with no parent, children, tags, page links, or record links, and records with no relations or page links.
- Build project summaries and focused views from these relationships before introducing a separate automation layer.

### 6. Add a personal home dashboard

Create a useful landing page from existing KBS data, with simple configurable sections or widgets.

- Recent pages already appear on the home page (“Jump back in”); continue with favorites, the capture inbox, and selected databases or views as configurable sections.
- [x] Add tasks due soon and current projects queues, each configured from an existing database and property, with the project queue's finished statuses chosen explicitly.
- [x] Support dashboard sections for saved database views, so any view (including active media queues and release dates) can be pinned from the home page with its own filters and sorts applied.
- [x] Keep widgets as saved views over existing information rather than creating a second copy of the data.
- [x] Add a personal timeline for dated notes, milestones, and tasks once date properties and calendar views are reliable. The home page's **Timeline** merges every database's date properties into one chronological list grouped by day, keeps a week of recent history, offers 7-, 30-, and 90-day horizons, and shows each record's database and date property beside its title.

### 7. Protect and organize personal data

- [x] Add a trash area with restore and permanent-delete actions. Trashing keeps the subtree, tags, links, and revisions intact so a page can be recovered whole.
- [x] Add page revision history and restore, so mistakes can be undone after the editor undo stack or local draft window is gone.
- [x] Add full workspace export/backup and a documented restore path, not just per-database exports. The JSON export covers every table; attachment bytes stay in `data/attachments` (or `ATTACHMENTS_DIR`) and the restore path is documented in [backup and restore](backup-and-restore.md).
- [x] Add scheduled or one-click backups that capture the attachments directory too, and a filesystem scan for files with no attachment row. `npm run backup` writes a dated folder holding `workspace.json`, every attachment byte, and a checksummed `manifest.json`, verifies each run, supports `--keep`, and is built for cron or Windows Task Scheduler; Trash → Backup exposes **Back up now** and **Check**, and **Remove unused files** deletes uploads nothing references. The schedule itself is configured on the host; see [backup and restore](backup-and-restore.md).
- Track source and capture date for imported or clipped information (data provenance). Capture date and source URL already exist for inbox items.
- Add optional local/offline-friendly behavior if the app's deployment model supports it; clearly communicate when edits are local versus saved to the server.

### 8. Add personal workflows that build on the foundation

- Add saved searches that act as dynamic collections.
- [x] Add a decision journal template for the decision, rationale, alternatives, expected outcome, and review date. It ships as a built-in starter page template beside the project kickoff.
- Add a reading list workflow that connects saved articles/books, highlights, and notes.
- Add a focus view that brings a chosen project, its tasks, and its related resources together.
- Consider knowledge review prompts for stale notes after search, dates, and history are dependable.

### 9. Complete everyday database workflows

- [x] Add a calendar view for date properties, with month navigation, today highlighting, and undated records.
- [x] Add list and timeline database views where they solve real use cases. A list flattens a view's visible values into scannable rows; a timeline groups a database by a date property with a 7-, 30-, or 90-day horizon, a week of recent history, and a separate section for undated records.
- [x] Add chart views where a numeric property makes the shape of the data easier to see. Bars are labelled and ordered largest first, a Select property can group and sum them, a pie shows share of total, a line follows the view's record order, and the view says how many bars and numeric values it left out.
- [x] Use calendar views for both task due dates and media release dates; the same view can be pinned to the personal home dashboard.
- [x] Support structured, per-view filters and multiple sort rules instead of a single text filter and one sort. Board grouping stays configured per board view.
- [x] Add per-view property visibility and view duplication/reordering.
- [x] Add a file/media property and show it on gallery cards as a cover.
- [x] Add formula properties; consider person and status properties when identity or team workflows arrive.
- [x] Use formula, relation, and rollup properties to show simple progress measures such as episodes or chapters completed and project task completion.
- [x] Improve record editing with a focused page/detail view that keeps properties and page content together.
- [x] Improve relation selection inside record pages. A relation property shows linked records as removable chips and links another through a searchable list of the target database's records, with keyboard selection and focus handling.
- [x] Add database templates that can be applied when creating records, and make template management discoverable.
- [x] Import a database's CSV export back into it, creating text properties for columns that do not match an existing one.
- [x] Import Markdown files or folders as pages, keeping headings, lists, quotes, code blocks, and inline marks, uploading embedded images and linked files (images, PDFs, office documents, archives, and other supported types) as attachments, and recreating a picked folder's tree as nested pages.
- [x] Show attachments with a type icon and label in inbox captures, record file cells, and embedded database views, and link non-image files from imported Markdown instead of rendering a broken image preview.
- [x] Upload, replace, or remove file-property attachments directly from database table cells, board cards, gallery cards, and record pages, with an accessible confirmation before removing a file value.
- [x] Confirm record and template deletion with the app's accessible dialog, matching view deletion and gallery cover removal.
- [x] Confirm database deletion, permanent trash deletion, unused-file cleanup, page and page-template deletion, and revision restore with the app's accessible dialog.
- [x] Let each gallery view choose which file property supplies its card cover, falling back to the first image attachment and keeping the chosen property's editable attachment row on the card.
- [x] Mark which file property supplied each gallery card's cover so the editable attachment rows are easy to scan.
- [x] Hide a gallery card's cover image without touching its attachment value, with a Show cover action to restore it.
- [x] Remove a gallery card's cover attachment after an accessible in-app confirmation, while keeping its file property row ready for a new upload.
- [x] Render gallery card covers, the cover-property badge, hide/show controls, the cover-property selector, and upload/replace/remove cover actions in embedded database views too.

## Later: multi-user readiness

Keep this as a far-future milestone. Before inviting additional users, add authentication, workspace ownership and membership, and enforce authorization and workspace isolation across every API read and mutation. Then consider:

- Sharing controls and page/database permissions.
- Live co-editing, comments, mentions, notifications, and activity history.
- User/person database properties and assignment workflows.
- Shared templates, workspace-level search, and team navigation.

Authentication alone is not sufficient: the current deployment notes correctly call for per-workspace isolation before a multi-user rollout. Keep the app single-user until that access model is implemented and reviewed.

## Not planned now

- AI writing, agents, meeting summaries, semantic search, and AI-generated relationships.
- Automation rules, scheduled workflows, webhooks, and integrations.
- Real-time collaboration and team features before multi-user support is intentionally started.
- Plugin systems, public publishing, and browser extensions until the core product and data model are dependable.

## Suggested sequence

1. Extend navigation where the daily workflows still need it — tag and page-group filters on the graph.
2. Add the personal workflows that remain: saved searches, a reading list, and a focus view for a project with its tasks and references.
3. Add multi-user identity, permissions, and collaboration when needed.

Database formulas, CSV and Markdown import, inbox file capture, one-click and scheduled backups, the decision journal template, the dashboard timeline, list, timeline, and chart database views, the graph filters and small-screen page list, explainable related-page suggestions, and the editor focus and selection polish have all shipped, so they are no longer steps here. Hosting and launch decisions are tracked in [deployment readiness](deployment-readiness.md).

Revisit the sequence using actual usage: prioritize the improvements that remove friction in capture, finding, connecting, and safely changing knowledge.
