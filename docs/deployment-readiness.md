# Deployment readiness

## Current status

The application builds and its unit and PostgreSQL integration checks pass locally. GitHub Actions has completed its first passing run and is configured to repeat those checks on pushes and pull requests.

A single-user password gate now protects every page and API route, so the app can be reached beyond localhost. It is not multi-user: there is one shared password and no per-workspace isolation. Do not invite other people until the access model below is implemented.

## Access model

- The initial deployment is for a single user, protected by the sign-in gate described below. Keep enforcing access checks on every new API route and server action as they are added.
- Keep the data model and access checks ready to grow into multi-user use. Before enabling additional users, add workspace membership and enforce per-workspace data isolation across every query and mutation. Do not treat authentication alone as sufficient for multi-user access.

## Sign-in

Set both variables in the host's secret manager:

- `KBS_AUTH_PASSWORD` — the workspace password.
- `KBS_AUTH_SECRET` — a random signing secret of at least 32 characters, for example `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`. Changing it signs every session out.

`/signin` compares the submitted password in constant time and sets a 30-day signed, `httpOnly`, `SameSite=Lax` session cookie; it is marked `Secure` when the request arrives over HTTPS, directly or through `X-Forwarded-Proto`. Signing out clears the cookie. Because the cookie is signed over both the expiry and the password, changing either variable invalidates existing sessions.

Server-side behaviour:

- With both variables set, every page redirects to `/signin` and every `/api/*` route returns `401` without a valid cookie. `_next/static`, `_next/webpack-hmr`, and `favicon.ico` stay public so the sign-in page can render.
- With either variable missing, or the secret shorter than 32 characters, a production build returns `503` for every request rather than serving data. A development server stays open so local work and the existing test suites need no credentials.
- Failed sign-ins are throttled per client address in memory (8 attempts per 10 minutes). The counter belongs to one server process, so it is a speed bump rather than a lockout; add request-level rate limiting at the proxy for a public host.

The gate answers who may enter, not what they may see. Before multi-user support, every query and mutation still needs a workspace scope.

## Before choosing a host

- Choose a host that supports the Next.js runtime features used here and a managed PostgreSQL service.
- Terminate TLS in front of the app. The password is sent from the browser on sign-in and the session cookie only gains its `Secure` flag over HTTPS.
- Confirm how the host provides TLS database connections, secret storage, log retention, and scheduled backups.

## Release checklist

1. Set `DATABASE_URL`, `KBS_AUTH_PASSWORD`, and `KBS_AUTH_SECRET` in the host's secret manager. Use a dedicated production database and the provider's TLS connection string. Never commit `.env` or production credentials.
2. Provision the production database, then run `npm run db:migrate` as a release step before starting the new application version. Do not run `db:generate` in production. The latest migration enables the `pg_trgm` extension that backs search, so the migration role must be allowed to create extensions (`pg_trgm` is a trusted extension from PostgreSQL 13 onward, so the database owner can do it without superuser rights).
3. Require the GitHub Actions workflow to pass before deployment. Its first run has passed. The database job creates and drops a uniquely named test database, so its CI role must be allowed to create databases.
4. Build with `npm ci` and `npm run build`, then start with `npm run start`.
5. Confirm that the deployed service can reach PostgreSQL, that an unauthenticated request is redirected to `/signin` (and `/api/*` returns `401`), and that signing in with `KBS_AUTH_PASSWORD` returns the expected page, database, and search results.

## Backups and restore

The supplied `compose.yaml` persists local PostgreSQL data in a Docker volume; a volume is not a backup. Uploaded images and files are stored on disk under `data/attachments` unless `ATTACHMENTS_DIR` is set. A PostgreSQL dump does not include those files; back up that directory with the database. The app provides a full workspace JSON export (Trash → Backup), `npm run backup` for a dated folder containing the export plus every attachment, and a `npm run restore:export` restore path; see [backup and restore](backup-and-restore.md).

For hosted production, enable the database provider's automated backups and point-in-time recovery where available. Set retention to match the recovery objective for the data.

For an additional manual backup with PostgreSQL client tools installed:

```bash
pg_dump --format=custom --file=kbs-backup.dump "$DATABASE_URL"
```

Restore into a separate, empty recovery database first and verify the restored pages and records before using it for cutover:

```bash
pg_restore --no-owner --dbname="$RECOVERY_DATABASE_URL" kbs-backup.dump
```

Practice a restore before launch and periodically afterward. Store backup files outside the app container, restrict access to them, and encrypt them at rest. The repository does not schedule backups itself. `npm run backup` is built for cron or Windows Task Scheduler (`--keep <n>` bounds the history) and runs its restore check on every backup, but nothing triggers it automatically until you add that schedule on the host.

## Monitoring

Every API failure writes one line of JSON to `console.error` with `level`, `time`, `requestId`, `method`, `path`, `message`, and the error's name, message, and stack. The proxy assigns the request ID (reusing a header-safe `x-request-id` from a trusted upstream proxy), forwards it to handlers, and returns it on every response, so a reported failure matches one log line. Error bodies include the same `requestId`.

Request headers, cookies, and bodies are never logged, so credentials and page content stay out of logs. Library and database error messages can still contain fragments of private data, so treat log storage with the same care as the database.

Before launch, configure host log retention and alerts on `level: "error"`, database connectivity, and failed deployments. Most hosts can index the JSON lines directly; keep `requestId` as the correlation key if you add an error tracker, and confirm the collector stores the stack trace inside the JSON string rather than splitting lines.

## Remaining launch decisions

- Hosting provider and database provider
- Multi-user rollout timing and workspace membership model (the initial deployment is single-user)
- Backup retention and recovery-time target
- Error monitoring and alert destination
- Whether the Geist fonts should be self-hosted to remove the build's dependency on Google Fonts availability
