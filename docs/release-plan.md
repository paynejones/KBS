# Release plan — v0.4.0 and v0.5.0

Planning date: 2026-11-19; the 0.5.0 section was added 2026-11-24. The 0.4.0 plan
below was written when `package.json` still said `0.3.0`, the latest migration was
`0028_database_grouping_page`, and the repository had no tags. It shipped on
2026-11-22 as `v0.4.0`; the current release is `0.5.0`.

## v0.5.0 — Notion import and hardening (current)

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
