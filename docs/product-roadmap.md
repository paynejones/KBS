# Product roadmap

This roadmap describes KBS as a self-hosted personal information system: a place to write, collect, connect, and act on personal knowledge. “Notion parity” is not the product goal. The priority is a coherent, fast experience built around the user's information and the relationships between it.

## Product direction

- Keep KBS useful as a single-user app first.
- Treat pages, databases, tasks, and files as parts of one connected information system.
- Favor quick capture, reliable retrieval, and easy navigation over feature count.
- Keep multi-user collaboration on the roadmap, but defer it until a real need arises.
- AI and automation are future possibilities, not current milestones.

## Current foundation

The app already includes nested pages, a basic rich-text editor, page reordering and moving, favorites, tags, explicit page links and backlinks, global search, recoverable local drafts, Markdown import/export helpers, and databases with table, board, and gallery views. Database properties include text, number, checkbox, date, URL, select, multi-select, relation, and rollup. Databases can be embedded in pages and exported as CSV or JSON.

This is a code-level inventory, not a claim that every feature has the same polish or breadth as its Notion equivalent.

## Near-term priorities

### 1. Make the editor feel complete

This is the current top priority: writing and shaping a page should feel natural before adding more ways to browse pages.

- Add slash-command insertion and keyboard shortcuts for common blocks and formatting.
- Add practical block types: task lists, code blocks, tables, callouts, toggles, dividers, and image/file embeds.
- Support drag-and-drop or other direct block reordering, with predictable selection and undo behavior.
- Add page icon and cover support, with clear loading and failure states for media.
- Improve editor focus, selection, mobile editing, and save-state feedback.
- Preserve reliable draft recovery and add an explicit way to recover or discard a recovered draft.

### 2. Build a connected knowledge graph

Add an Obsidian-style connection map that makes page relationships visible and navigable.

- Provide a workspace graph showing pages as nodes and links as edges.
- Provide a local graph centered on the open page, with controls for neighborhood depth.
- Support zoom, pan, drag, node search, and opening a page from its node.
- Distinguish explicit links from parent/child structure, and optionally show shared tags as a separate relation.
- Offer useful empty and dense graph states, plus filters for tags, favorites, and page groups.
- Keep graph navigation usable on smaller screens and offer a list-based alternative.

KBS already stores explicit links and backlinks, so those can seed the graph. Graph rendering should remain a navigation aid: the existing tree remains the clearest way to manage hierarchy.

### 3. Make page linking and capture faster

- Add wiki-style `[[page name]]` linking with autocomplete, link creation, and graceful handling of renamed pages.
- Make backlinks easier to scan, including a count and context/snippet for where the link appears.
- Add a quick capture action that creates an inbox page without requiring the user to choose a destination first.
- Add a command palette for creating pages/databases, jumping to favorites and recent pages, and common navigation actions. Search already uses Ctrl/Cmd+K; extend that interaction or reserve a consistent shortcut scheme.
- Add recent pages and recently edited pages for quick return paths.
- Add page templates for repeatable note structures.

### 4. Add a universal capture inbox

Make it easy to save something now and organize it later.

- Add a dedicated inbox for quick notes, ideas, URLs, tasks, and references.
- Let captured items become regular pages or database records without losing their source or capture date.
- Store URL title, address, description, and optional selected text for saved links.
- Add file, image, and PDF capture after attachment storage and previews are in place.
- Consider a browser extension as a later companion to the core inbox, not a prerequisite.

### 5. Make relationships useful across the system

- Let pages link to database records and let records link to pages, projects, tasks, and other records.
- Make relation fields easier to navigate in both directions, with related items visible from the relevant page or record.
- Add related-page suggestions based on existing explicit links, shared tags, and shared relations. Keep suggestions explainable and optional; defer semantic/AI suggestions.
- Surface orphaned pages and records that have no meaningful connections.
- Build project summaries and focused views from these relationships before introducing a separate automation layer.

### 6. Add a personal home dashboard

Create a useful landing page from existing KBS data, with simple configurable sections or widgets.

- Start with recent pages, favorites, the capture inbox, and selected databases or views.
- Add tasks due soon and current projects after task and date workflows are established.
- Keep widgets as saved views over existing information rather than creating a second copy of the data.
- Add a personal timeline for dated notes, milestones, and tasks once date properties and calendar views are reliable.

### 7. Protect and organize personal data

- Add a trash area with restore and permanent-delete actions.
- Add page revision history and restore, so mistakes can be undone after the editor undo stack or local draft window is gone.
- Add full workspace export/backup and a documented restore path, not just per-database exports.
- Track source and capture date for imported or clipped information (data provenance).
- Add optional local/offline-friendly behavior if the app's deployment model supports it; clearly communicate when edits are local versus saved to the server.

### 8. Add personal workflows that build on the foundation

- Add saved searches that act as dynamic collections.
- Add a decision journal template for the decision, rationale, alternatives, expected outcome, and review date.
- Add a reading list workflow that connects saved articles/books, highlights, and notes.
- Add a focus view that brings a chosen project, its tasks, and its related resources together.
- Consider knowledge review prompts for stale notes after search, dates, and history are dependable.

### 9. Complete everyday database workflows

- Add calendar and list views first, followed by timeline and chart views where they solve real use cases.
- Support structured, per-view filters and multiple sort/group rules, rather than relying on a single text filter and sort configuration.
- Add per-view property visibility and view duplication/reordering.
- Add formula properties and a file/media property; consider person and status properties when identity or team workflows arrive.
- Improve record editing with a focused page/detail view and better relation selection.
- Add database templates that can be applied when creating records, and make template management discoverable.
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

1. Editor blocks, slash commands, keyboard shortcuts, and reliable media handling.
2. Universal capture inbox and faster page linking.
3. Graph view, related pages, and orphan discovery.
4. Command center, recents, and saved searches.
5. Cross-page/database relationships and useful personal dashboard.
6. Database views, filters, and import.
7. Trash, revisions, and full export/restore.
8. Personal workflows such as decision journal, reading list, and focus view.
9. Multi-user identity, permissions, and collaboration when needed.

Revisit the sequence using actual usage: prioritize the improvements that remove friction in capture, finding, connecting, and safely changing knowledge.
