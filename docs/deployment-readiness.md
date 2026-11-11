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

Passwords can also be changed from **Settings** (`/settings`) while signed in. The app writes a salted scrypt hash to `data/auth-credential.json`, or to the file named by `KBS_AUTH_CREDENTIAL_PATH`, and the proxy prefers it over `KBS_AUTH_PASSWORD` on every request. The change therefore applies without a restart and without a database round trip, and every existing session except the browser that made the change is signed out. Keep `KBS_AUTH_PASSWORD` set: it remains the recovery credential, and deleting the stored file returns to it. Because the credential is a server-local file, like the attachments directory, a multi-instance deployment must share it or change the password through a single instance.

The gate answers who may enter, not what they may see. Before multi-user support, every query and mutation still needs a workspace scope.

## Before choosing a host

- Choose a host that supports the Next.js runtime features used here and a managed PostgreSQL service. The database requirements, TLS behaviour, and migration ordering are documented in [managed PostgreSQL deployment](managed-postgres.md).
- Terminate TLS in front of the app. The password is sent from the browser on sign-in and the session cookie only gains its `Secure` flag over HTTPS.
- Confirm how the host provides TLS database connections, secret storage, log retention, and scheduled backups.

## Release checklist

1. Set `DATABASE_URL`, `KBS_AUTH_PASSWORD`, and `KBS_AUTH_SECRET` in the host's secret manager. Use a dedicated production database and the provider's TLS connection string. Never commit `.env` or production credentials.
2. Provision the production database, then run `npm run db:migrate` as a release step before starting the new application version (see [managed PostgreSQL deployment](managed-postgres.md)). Do not run `db:generate` in production. The latest migration enables the `pg_trgm` extension that backs search, so the migration role must be allowed to create extensions (`pg_trgm` is a trusted extension from PostgreSQL 13 onward, so the database owner can do it without superuser rights).
3. Require the GitHub Actions workflow to pass before deployment. Its first run has passed. The database job creates and drops a uniquely named test database, so its CI role must be allowed to create databases.
4. Build with `npm ci` and `npm run build`, then start with `npm run start`.
5. Confirm that the deployed service can reach PostgreSQL, that an unauthenticated request is redirected to `/signin` (and `/api/*` returns `401`), and that signing in with `KBS_AUTH_PASSWORD` returns the expected page, database, and search results.

## Container deployment

`Dockerfile` builds the app for a single long-lived instance with a writable data directory, because attachments, the stored password, and backups are server-local files. `compose.yaml` wires that image to a Postgres service and a named volume:

```bash
# .env: POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB,
#       KBS_AUTH_PASSWORD, KBS_AUTH_SECRET
#       (optionally KBS_DATABASE_URL for a managed database, and KBS_PORT)
docker compose up -d --build
```

The stack has four services. `migrate` runs `npm run db:migrate` once and exits, and `app` starts only after it succeeds, so a release never serves a new version against an old schema. `app` publishes port 3000 (or `KBS_PORT`) and mounts the `kbs_data` volume at `/data`, which holds `attachments/`, `auth-credential.json`, and `backups/`. Set `KBS_DATABASE_URL` to use a managed PostgreSQL instance instead of the bundled `db` service; the bundled one then stays idle. [Managed PostgreSQL deployment](managed-postgres.md) covers the endpoint, TLS, and migration details. The stack ignores `DATABASE_URL` from a development `.env`, because a `localhost` URL is wrong inside a container.

The image runs as uid/gid 1001 (`nextjs`), which owns `/data` on a named volume. A bind mount must be made writable by that user first. The `backup` service runs `npm run backup -- --keep N` on an interval inside the container and writes each verified backup to `backups/` on the same volume, so the host needs no cron entry. It publishes no port and does not take the auth variables. `BACKUP_KEEP` (default `7`) bounds the history, `BACKUP_INTERVAL_HOURS` (default `24`) sets the interval, and `BACKUP_ON_START` (default `true`) takes one as soon as the service starts. A failed run leaves its folder for inspection, logs the failure, and retries on the next interval without stopping the service; watch it with `docker compose logs -f backup`. The volume is not off-site storage, so copy backups to another machine or use the database provider's snapshots.

The healthcheck requests `/signin`, which is the only route that answers without a session; a `503` there means `KBS_AUTH_PASSWORD`/`KBS_AUTH_SECRET` are missing or the secret is too short.

## Releasing

`.github/workflows/release.yml` turns a push to `main` into a release, in a fixed order:

1. `verify` calls the CI workflow, so a commit that fails tests, lint, type checks, the build, or the browser suite is never released.
2. `images` builds the `runner`, `migrate`, and `backup` targets and pushes them to GHCR tagged with the commit SHA.
3. `deploy` runs `scripts/deploy-release.sh` on the host: pull the three images, run `docker compose run --rm migrate`, and only then `docker compose up -d --no-build app backup`.

The migration step is the gate. If it exits non-zero the script stops before recreating anything, so the previous version keeps serving and no new build runs against an old schema. Once the app is recreated, the script waits for the container's `/signin` healthcheck and fails the job with the last 40 log lines if it never becomes healthy. Migrations run on the host, so the production database never has to be reachable from GitHub.

Required repository secrets: `DEPLOY_HOST`, `DEPLOY_USER`, and `DEPLOY_SSH_KEY` (a private key whose public half is in the host's `authorized_keys`). Optional repository variable: `DEPLOY_PATH`, default `/srv/kbs`, which must be a checkout of this repository. The host must also be able to pull the images: run `docker login ghcr.io` there once with a token that can read packages, or make the packages public. The `deploy` job uses the `production` environment, so approvals can be required there.

Until `DEPLOY_HOST` is set, a release only publishes images and the deploy job reports a notice instead of failing every push.

To release a specific commit by hand:

```bash
KBS_IMAGE_REPOSITORY=ghcr.io/<owner>/<repo> \
KBS_IMAGE_TAG=<commit-sha> \
sh scripts/deploy-release.sh
```

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

Practice a restore before launch and periodically afterward. Store backup files outside the app container, restrict access to them, and encrypt them at rest. The container stack schedules backups itself through the `backup` service, and every run is verified and pruned with `--keep <n>`; a non-container deployment runs `npm run backup` from cron, a systemd timer, or Windows Task Scheduler. Either way the result sits next to the live data until you copy it elsewhere, so ship it off the machine.

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
