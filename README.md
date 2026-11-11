This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Signing in

KBS is a single-user workspace behind one password. Set both variables to enable the gate:

```bash
KBS_AUTH_PASSWORD=your-workspace-password
KBS_AUTH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
```

`/signin` then issues a 30-day signed, httpOnly session cookie, and every page, API route, and attachment request needs it. With either variable unset the development server stays open for local work; a production build returns `503` instead of serving unauthenticated data. See [the deployment readiness runbook](docs/deployment-readiness.md) for the full behaviour and release steps.

## Reliability checks

Run the pure reliability tests with:

```bash
npm test
```

Run the DOM component tests with:

```bash
npm run test:dom
```

DOM tests that replace `fetch` must use the strict route-table helper described in [DOM testing](docs/dom-testing.md): every method and URL is explicit, and cleanup fails on any unhandled request.

Run the browser-level workflow checks with:

```bash
npm run test:browser
```

Playwright starts an isolated Next.js server at `http://127.0.0.1:3100`, creates and migrates a temporary PostgreSQL database from `DATABASE_URL`, and drops it (and its temporary attachments directory) when the run ends, even though the server process is force-killed on Windows. It never uses the development server or database. Install Chromium once with `npx playwright install chromium`; set `PLAYWRIGHT_PORT` to use another port.

Run the PostgreSQL transaction checks with:

```bash
npm run test:db
```

The database check uses `DATABASE_URL` only to create a uniquely named temporary database, applies the project migrations there, runs the checks, and drops that temporary database afterward. It requires permission to create databases and connect to the PostgreSQL `postgres` database. It does not run mutations against the configured application database.

Measure search against a large workspace with:

```bash
npm run bench:search
```

It also uses only a temporary database: it applies the migrations, seeds 20,000 pages and 5,000 records (`SEARCH_BENCH_PAGES` overrides the page count), and reports the median time for each search query before and after the trigram indexes are built, with the query plan it used. Global search and the page browser match with `ILIKE '%term%'`, so migration `0023` enables the `pg_trgm` extension and indexes page titles, page bodies, record titles, and record values as trigrams. Terms of two characters or fewer carry no trigrams and still scan.

See [the deployment readiness runbook](docs/deployment-readiness.md) for migration, security, and monitoring requirements before hosting.

See [backup and restore](docs/backup-and-restore.md) for the workspace JSON export, the attachments directory, and the `npm run restore:export` restore path.
