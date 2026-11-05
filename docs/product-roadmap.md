# Product roadmap

This roadmap describes KBS as a self-hosted personal information system: a place to write, collect, connect, and act on personal knowledge. “Notion parity” is not the product goal. The priority is a coherent, fast experience built around the user's information and the relationships between it.

## Product direction

- Keep KBS useful as a single-user app first.
- Treat pages, databases, tasks, and files as parts of one connected information system.
- Favor quick capture, reliable retrieval, and easy navigation over feature count.
- Keep multi-user collaboration on the roadmap, but defer it until a real need arises.
- AI and automation are future possibilities, not current milestones.

## Current foundation

The app already includes nested pages, a rich-text editor with slash commands and wiki-style `[[page]]` links, page reordering and moving, favorites, tags, explicit page links and backlinks, a Ctrl/Cmd+K command palette over search and navigation, recent pages, trash with restore and permanent delete, a full workspace JSON export with a restore script, recoverable local drafts with recover/discard, Markdown import/export helpers, page icons and remote or uploaded covers, page revision history, and databases with table, board, and gallery views. Database properties include text, number, checkbox, date, URL, select, multi-select, file/media, relation, and rollup. Databases can be embedded in pages, use record templates, and export as CSV or JSON. A workspace graph shows page links and parent/child structure, including a local neighborhood view. An inbox supports quick capture of notes and URLs.

This is a code-level inventory, not a claim that every feature has the same polish or breadth as its Notion equivalent.

## Recently completed

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

- **Media presentation:** page icons, covers, uploaded or linked images/files, and image-backed gallery cards are in place. Remaining polish includes mobile editing, save-state feedback, and later inbox file/PDF capture.
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
- Support drag-and-drop or other direct block reordering, with predictable selection and undo behavior. Keyboard block move already exists.
- Improve editor focus, selection, mobile editing, and save-state feedback.

### 2. Build a connected knowledge graph

Add an Obsidian-style connection map that makes page relationships visible and navigable.

- [x] Provide a workspace graph showing pages as nodes and links as edges.
- [x] Provide a local graph centered on the open page, with controls for neighborhood depth.
- [x] Support zoom, pan, drag, node search, and opening a page from its node.
- [x] Distinguish explicit links from parent/child structure, and optionally show shared tags as a separate relation.
- Offer useful empty and dense graph states, plus filters for tags, favorites, and page groups.
- Keep graph navigation usable on smaller screens and offer a list-based alternative.

KBS already stores explicit links and backlinks, so those can seed the graph. Graph rendering should remain a navigation aid: the existing tree remains the clearest way to manage hierarchy.

### 3. Make page linking and capture faster

This is the current top product priority after media: jump, create, and connect without leaving the keyboard.

- [x] Add wiki-style `[[page name]]` linking with autocomplete and link creation. Links use stable page IDs so renaming a page does not break its destination.
- [x] Add a quick capture action that creates an inbox page without requiring the user to choose a destination first.
- [x] Make backlinks easier to scan, with a count and a quoted snippet of the sentence where each inline link appears.
- Add an inline link control for external URLs and pages, with page-name autocomplete; keep the existing page-connections panel for managing relationships and backlinks.
- [x] Add a command palette for creating pages/databases, jumping to favorites and recent pages, and common navigation actions. It owns Ctrl/Cmd+K, replacing the previous search-only overlay.
- [x] Add recent pages for quick return paths. Visits are stored per browser, surfaced on the home page as “Jump back in” and at the top of the command palette, and kept separate from the server-driven recently-updated list.
- Extend the palette with more actions, such as saved views or inbox capture, and make recents follow the user across devices if that becomes useful.
- Add page templates for repeatable note structures.

### 4. Add a universal capture inbox

Make it easy to save something now and organize it later.

- [x] Add a dedicated inbox for quick notes, ideas, and URLs.
- [x] Let captured items become regular pages or database records without losing their source or capture date.
- [x] Render saved links as compact previews that show the title and source and open the original URL directly.
- Store URL title, address, description, and optional selected text for saved links.
- Add file, image, and PDF capture now that attachment storage and previews are in place.
- Consider a browser extension as a later companion to the core inbox, not a prerequisite.

### 5. Make relationships useful across the system

- Let pages link to database records and let records link to pages, projects, tasks, and other records.
- Make relation fields easier to navigate in both directions, with related items visible from the relevant page or record.
- Add related-page suggestions based on existing explicit links, shared tags, and shared relations. Keep suggestions explainable and optional; defer semantic/AI suggestions.
- Surface orphaned pages and records that have no meaningful connections.
- Build project summaries and focused views from these relationships before introducing a separate automation layer.

### 6. Add a personal home dashboard

Create a useful landing page from existing KBS data, with simple configurable sections or widgets.

- Recent pages already appear on the home page (“Jump back in”); continue with favorites, the capture inbox, and selected databases or views as configurable sections.
- Add tasks due soon and current projects after task and date workflows are established.
- Support dashboard sections for saved database views, including active media queues and release dates, plus quick actions for capturing a note or creating a common record.
- Keep widgets as saved views over existing information rather than creating a second copy of the data.
- Add a personal timeline for dated notes, milestones, and tasks once date properties and calendar views are reliable.

### 7. Protect and organize personal data

- [x] Add a trash area with restore and permanent-delete actions. Trashing keeps the subtree, tags, links, and revisions intact so a page can be recovered whole.
- [x] Add page revision history and restore, so mistakes can be undone after the editor undo stack or local draft window is gone.
- [x] Add full workspace export/backup and a documented restore path, not just per-database exports. The JSON export covers every table; attachment bytes stay in `data/attachments` (or `ATTACHMENTS_DIR`) and the restore path is documented in [backup and restore](backup-and-restore.md).
- Add scheduled or one-click backups that capture the attachments directory too, and a filesystem scan for files with no attachment row.
- Track source and capture date for imported or clipped information (data provenance). Capture date and source URL already exist for inbox items.
- Add optional local/offline-friendly behavior if the app's deployment model supports it; clearly communicate when edits are local versus saved to the server.

### 8. Add personal workflows that build on the foundation

- Add saved searches that act as dynamic collections.
- Add a decision journal template for the decision, rationale, alternatives, expected outcome, and review date.
- Add a reading list workflow that connects saved articles/books, highlights, and notes.
- Add a focus view that brings a chosen project, its tasks, and its related resources together.
- Consider knowledge review prompts for stale notes after search, dates, and history are dependable.

### 9. Complete everyday database workflows

- Add calendar and list views first, followed by timeline and chart views where they solve real use cases.
- Use calendar views for both task due dates and media release dates; make it possible to surface the same views on the personal home dashboard.
- Support structured, per-view filters and multiple sort/group rules, rather than relying on a single text filter and sort configuration.
- Add per-view property visibility and view duplication/reordering.
- [x] Add a file/media property and show it on gallery cards as a cover.
- Add formula properties; consider person and status properties when identity or team workflows arrive.
- Use formula, relation, and rollup properties to show simple progress measures such as episodes or chapters completed and project task completion.
- Improve record editing with a focused page/detail view and better relation selection.
- [x] Add database templates that can be applied when creating records, and make template management discoverable.
- Add import paths for CSV and Markdown exports, complementing existing exports and Markdown helpers.

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

1. Add page templates and finish the remaining editor polish (block reordering, mobile editing, save-state feedback).
2. Add an inline link control for external URLs and pages, and store richer metadata for captured URLs.
3. Add related-item discovery, orphan views, and useful personal dashboard sections.
4. Expand database views (calendar/list first), structured filters, formulas, and import.
5. Add scheduled backups that include attachment files, and a filesystem-level orphan scan.
6. Add inbox file/PDF capture and personal workflows such as a decision journal, reading list, and focus view.
7. Add multi-user identity, permissions, and collaboration when needed.

Revisit the sequence using actual usage: prioritize the improvements that remove friction in capture, finding, connecting, and safely changing knowledge.
