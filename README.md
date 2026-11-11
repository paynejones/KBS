# KBS

**A calm, single-user personal knowledge system.** Write pages, model structured data, and connect the two — with search, capture, and backups that make it useful every day.

[![CI](https://github.com/paynejones/KBS/actions/workflows/ci.yml/badge.svg)](https://github.com/paynejones/KBS/actions/workflows/ci.yml)
![Next.js 16](https://img.shields.io/badge/Next.js-16-black)
![React 19](https://img.shields.io/badge/React-19-087ea4)
![PostgreSQL 17](https://img.shields.io/badge/PostgreSQL-17-336791)
![Node 22+](https://img.shields.io/badge/Node-22%2B-5fa04e)

![The KBS home dashboard](docs/screenshots/home.png)

## What it is

KBS is a self-hosted workspace for notes, projects, and the reference material around them. It is built for one person, not a team: one password, one workspace, no sharing model to get in the way. Pages and database records are two views of the same information, and the links between them are first-class rather than an afterthought.

- **Capture without deciding.** Save a note, a link with its preview, a highlighted passage, or a file now and sort it later.
- **Write in a real editor.** Slash commands, `[[page]]` links, drag-and-drop blocks, and a save state that always says what it is doing.
- **Model data where it belongs.** Databases with typed properties, formulas, relations, and seven view types — then embed a view inside a page.
- **Keep the connections.** Backlinks, related-page suggestions, a filterable graph, and a focus view that gathers one project's tasks, subpages, and references.
- **Own your data.** PostgreSQL rows plus plain files on disk, a full JSON export, verified backups, and a Docker image that runs on one host.

## A quick tour

### A daily landing page

The home screen is built from real records: what is due soon, which projects are still in flight, a merged timeline of dated records, and any saved database view pinned as a widget. Pinned projects show a task progress bar and let you check work off in place.

### Writing that stays out of the way

![A page open in the editor](docs/screenshots/page-editor.png)

The editor handles headings, lists, task lists, quotes, code, tables, callouts, and images, with slash commands for structure and `[[` autocomplete for links. Blocks can be dragged by their grip or moved with `Alt+Shift+↑/↓`, and the page rail keeps an outline one click away.

### Databases, not spreadsheets

![A database table view](docs/screenshots/database.png)

Every database has typed properties — text, number, checkbox, date, URL, select, multi-select, file, relation, rollup, and formula — and views that remember their own filters, sorts, visible properties, and layout. Table, board, gallery, calendar, list, timeline, and chart views all read the same records, and every record owns a full page where properties and notes live together.

### Connections you can see

![The workspace graph](docs/screenshots/graph.png)

The graph draws page links and parent/child structure, with tag, page-group, favorite, and shared-tag filters plus a local neighborhood around any page.

![The focus view for a project](docs/screenshots/focus.png)

The focus view pulls one project's task lists from its page and subpages into a single checklist — ticking a task writes back to the page that holds it — beside that project's subpages, links, backlinks, and related records.

### Capture now, sort later

![The capture inbox](docs/screenshots/inbox.png)

The inbox accepts quick notes, links with their title, description, site name, and preview image, an optional selected-text quote, and one image or PDF. Items become ordinary pages or database records when you are ready, keeping their source and capture date.

### A reading list with the passages that mattered

![The reading list](docs/screenshots/reading.png)

Articles and books move through to-read, reading, and finished. Each item owns a notes page, and highlights stay beside the item with a note about why they matter.

### Finding things again

Pages are searchable by title and body through PostgreSQL trigram indexes, with a `Ctrl/Cmd+K` command palette over search, pages, records, recent pages, and destinations. Saved searches keep a set of filters as a live collection that re-runs every time it opens.

## Feature highlights

**Pages and editing** — nested pages, icons and covers, page templates, revision history with restore, recoverable drafts, and Markdown import/export.

**Linking** — `[[page]]` autocomplete, backlinks with the sentence around each mention, related-page suggestions that name the shared records or tags behind them, and bidirectional page-to-record connections.

**Data** — per-view filters and multi-sort, property visibility, view duplication and reordering, record templates, relations with a reverse "linked from" list, rollups, formulas, CSV import and export, and embedded database views inside pages.

**Workspace** — trash with restore and permanent delete, unused-file cleanup, a merged timeline, saved searches, recents, favorites, and a workspace graph.

**Operations** — a full workspace JSON export, verified backups with checksums, a one-password sign-in gate, structured JSON error logs with request IDs, and a Docker image with migration and backup stages.

## Getting started

### Prerequisites

- **Node.js 22 or newer** (CI runs 22)
- **PostgreSQL 17** — either a local server or the bundled Docker service
- **Docker** if you want the provided database service; **npm** for everything else

### 1. Install dependencies

```bash
git clone https://github.com/paynejones/KBS.git
cd KBS
npm ci
```

### 2. Create the environment file

```bash
cp .env.example .env
```

Then set the values:

```bash
# Database used by the app, migrations, backups, and the tests
DATABASE_URL=postgresql://kbs:kbs@localhost:5432/kbs

# Credentials for the bundled Docker Postgres service
POSTGRES_USER=kbs
POSTGRES_PASSWORD=kbs
POSTGRES_DB=kbs

# The workspace password and session signing secret
KBS_AUTH_PASSWORD=choose-a-workspace-password
KBS_AUTH_SECRET=paste-a-random-secret-of-at-least-32-characters
```

Generate the secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### 3. Start PostgreSQL

```bash
docker compose up -d db
```

This publishes Postgres on `127.0.0.1:5432`, matching the `DATABASE_URL` above. To use an existing server instead, skip this step and point `DATABASE_URL` at it.

### 4. Apply the migrations

```bash
npm run db:migrate
```

The migration set enables the `pg_trgm` extension, so the role needs permission to create it — the database owner can, on PostgreSQL 13 or newer. Never run `db:generate` outside development: it writes new migration files.

### 5. Run it

```bash
npm run dev
```

Open <http://localhost:3000>. With `KBS_AUTH_PASSWORD` and `KBS_AUTH_SECRET` set you sign in once at `/signin` and receive a 30-day session cookie; every page, API route, and attachment needs it. With either variable unset the development server stays open for local work, while a production build returns `503` instead of serving unauthenticated data.

### A note on the sign-in gate

The password lives in the environment, or as a salted scrypt hash in `data/auth-credential.json` after you change it in **Settings**. Changing it signs out every other browser and needs no restart. Deleting that file falls back to `KBS_AUTH_PASSWORD`, which is the recovery path. Because the credential is a server-local file, a multi-instance deployment must share it.

KBS is single-user by design: one shared password and no per-workspace isolation. Do not invite other people until the access model in the [deployment runbook](docs/deployment-readiness.md) is implemented.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | — | PostgreSQL connection string used by the app, migrations, backups, and checks |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | — | Credentials for the bundled Docker database service |
| `KBS_AUTH_PASSWORD` | — | Workspace password; required in production |
| `KBS_AUTH_SECRET` | — | Session signing secret, at least 32 characters; changing it signs everyone out |
| `KBS_AUTH_CREDENTIAL_PATH` | `data/auth-credential.json` | Where a password changed in Settings is stored |
| `ATTACHMENTS_DIR` | `data/attachments` | Uploaded images and files |
| `BACKUPS_DIR` | `data/backups` | Folders written by `npm run backup` |
| `KBS_PORT` | `3000` | Host port published by the compose stack |
| `KBS_DATABASE_URL` | bundled service | Managed PostgreSQL connection string for the compose stack |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` / `npm start` | Build and serve the production app |
| `npm test` | Pure logic and reliability tests |
| `npm run test:dom` | Component tests in jsdom |
| `npm run test:api` | API route tests against a temporary database |
| `npm run test:db` | PostgreSQL transaction checks in a temporary database |
| `npm run test:browser` | Playwright workflow tests on an isolated server and database |
| `npm run bench:search` | Measure search on a seeded workspace of 20,000 pages |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:check` | Verify the configured database connection |
| `npm run db:generate` | Generate migrations from the schema (development only) |
| `npm run backup` | Write a verified backup to `BACKUPS_DIR`; `--keep <n>` prunes old copies |
| `npm run restore:export` | Restore a workspace JSON export |
| `npm run lint` | ESLint |

The database-backed suites create and drop their own uniquely named temporary database from `DATABASE_URL`; they never mutate the configured application database. The browser suite starts its own server on `127.0.0.1:3100`. Install Chromium once with `npx playwright install chromium` before the first browser run.

## Running it with Docker

```bash
docker compose up -d --build
```

The stack has four services. `migrate` applies the schema once and exits; `app` starts only after it succeeds, so a release never serves a new version against an old schema. `backup` writes a verified workspace backup on an interval and keeps the newest `BACKUP_KEEP` copies (default 7, every 24 hours). Everything the app writes — attachments, the stored password, and backups — lives on the `kbs_data` volume mounted at `/data`.

A push to `main` builds the three images, publishes them to GHCR tagged with the commit SHA, and runs the same migration-then-deploy ordering on the host. The [deployment runbook](docs/deployment-readiness.md) covers secrets, the release workflow, and the production checklist; [managed PostgreSQL deployment](docs/managed-postgres.md) covers external databases, TLS, and migration ordering.

## Tech stack

- **Framework:** Next.js 16 App Router, React 19, TypeScript
- **Database:** PostgreSQL 17 with Drizzle ORM and committed SQL migrations
- **Editor:** TipTap 3 with custom extensions for links, drag handles, and block moves
- **UI:** Tailwind CSS 4, Base UI, lucide icons, light and dark themes
- **Tests:** Node's test runner, Testing Library in jsdom, and Playwright

## Project layout

```text
src/app/          Routes: pages, databases, graph, focus, inbox, reading, searches, settings
src/components/   Editor, database views, dashboard, graph, and shared UI
src/lib/          Pure domain logic: auth, filters, formulas, focus, backups, markdown
src/db/           Drizzle schema and database client
drizzle/          SQL migrations and their journal
scripts/          Backup, restore, deploy, and verification commands
tests/            Node, DOM, API, database, and Playwright suites
docs/             Runbooks, architecture notes, and the product roadmap
```

## Documentation

- [Deployment readiness](docs/deployment-readiness.md) — access model, release checklist, container deployment, monitoring
- [Managed PostgreSQL](docs/managed-postgres.md) — TLS, connection strings, migration ordering
- [Backup and restore](docs/backup-and-restore.md) — exports, attachments, verified backups, restore paths
- [Product roadmap](docs/product-roadmap.md) — what is shipped, what is next, and what is deliberately not planned
- [DOM testing](docs/dom-testing.md) — the strict route-table helper for component tests

## License

See [LICENSE](LICENSE).
