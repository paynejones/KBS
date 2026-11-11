# Managed PostgreSQL deployment

KBS keeps its rows in PostgreSQL and three things on local disk: uploaded attachments,
the password set in Settings, and backups. Moving the database to a managed service
changes one dependency, not the whole deployment — the app still needs a persistent
volume. The access model, sign-in gate, and container stack are covered in
[deployment readiness](deployment-readiness.md); this page covers the database path end
to end: what the database must allow, which connection string each component uses, how
this app resolves TLS, and the order migrations and the app must start in.

## What the database must provide

- **PostgreSQL 17.** Development and CI both run 17. Older servers usually work, but
  nothing in the test suite covers them.
- **A role that can run DDL and create the `pg_trgm` extension.** Migration
  `0023_search_trgm_indexes` runs `CREATE EXTENSION IF NOT EXISTS pg_trgm` before it
  builds the trigram indexes behind global search. `pg_trgm` is a trusted extension from
  PostgreSQL 13, so the database owner can install it; a provider that withholds that
  from the application role needs an administrator to run
  `CREATE EXTENSION IF NOT EXISTS pg_trgm;` once. That is safe to do ahead of the
  migration.
- **A TLS endpoint**, with either a publicly trusted certificate or a provider CA bundle
  you can mount (see below).
- **Automated backups or point-in-time recovery.** The on-volume backup captures rows and
  attachments, not the server's write-ahead log.
- **Connections for one pool per app process.** `src/db/index.ts` creates a single `pg`
  `Pool` using the library default of 10 connections. The migration and backup jobs open
  their own short-lived pools.

## Connection strings and TLS

One variable carries the connection everywhere:

| Consumer | Reads |
| --- | --- |
| App (`src/db/index.ts`) | `DATABASE_URL` |
| Migrations (`drizzle.config.ts` via `npm run db:migrate`) | `DATABASE_URL` |
| `npm run db:check`, `npm run backup`, `npm run restore:export` | `DATABASE_URL` |

No code sets `ssl` explicitly, so TLS is decided entirely by the URL, which node-postgres
parses with `pg-connection-string`. The migration runner and the repo scripts connect
through the same driver, so a TLS setting that fails for the app fails at `migrate` the
same way. For the installed version, `pg` 8.23, this is what each parameter produces:

| In the URL | What the driver does | When to use it |
| --- | --- | --- |
| *(no parameter)* | `ssl: undefined` — plaintext | never for a remote database |
| `sslmode=disable` | `ssl: false` — plaintext | local development only |
| `sslmode=require` | TLS on, certificate **and** hostname verified | providers using a publicly trusted certificate |
| `sslmode=verify-full` | same as `require` here, without the deprecation warning | the mode to name explicitly |
| `sslmode=no-verify` | `ssl: { rejectUnauthorized: false }` — encrypted, unauthenticated | last resort on a network you already trust |
| `sslrootcert=/certs/ca.pem` | file read **when the URL is parsed** and set as `ssl.ca` | private CA bundles |
| `sslcert=`, `sslkey=` | client certificate and key read at parse time | mutual TLS |

Two details matter in practice:

- **`sslmode=require` verifies the certificate here**, unlike libpq, which treats it as
  encryption only. A provider with a private CA therefore needs `sslrootcert`, not a
  weaker mode; a missing or wrong CA fails the connection rather than silently downgrading.
- **`sslrootcert` is read when the string is parsed, at process start.** Mount the CA
  file at a stable path in every service that opens the database — `app`, `migrate`, and
  `backup` — because each parses the URL itself. A wrong path fails the container at
  startup with `ENOENT`, not on the first query.

Examples:

```bash
# Publicly trusted CA
KBS_DATABASE_URL=postgresql://user:password@db.example.com:5432/kbs?sslmode=verify-full

# Private CA bundle, mounted at /certs/ca.pem in app, migrate, and backup
KBS_DATABASE_URL=postgresql://user:password@db.example.com:5432/kbs?sslmode=verify-full&sslrootcert=/certs/ca.pem
```

Percent-encode reserved characters in the password (`@` becomes `%40`). Percent-encoding
is also why the URL works unmodified through compose interpolation.

### Direct versus pooled endpoints

Most providers offer a direct endpoint and a transaction-pooling endpoint. Use the
**direct** endpoint for `migrate`: migrations are a sequence of DDL statements in one
session, and a transaction pooler may hand that session to different backends. The app
may use a pooled endpoint if the provider documents it as compatible, which keeps its
10-connection pool inside the plan's cap. The backup and restore scripts read the same
variable, so whichever endpoint the app uses, the backup job can use it too.

## Wiring it into the container stack

The host keeps the connection string in `.env`, which is never committed:

```bash
KBS_DATABASE_URL=postgresql://user:password@db.example.com:5432/kbs?sslmode=verify-full
# The bundled db service still starts and still needs a password, even unused.
POSTGRES_PASSWORD=unused-throwaway-value
KBS_AUTH_PASSWORD=your-workspace-password
KBS_AUTH_SECRET=a-random-signing-secret-of-at-least-32-characters
```

Compose maps `KBS_DATABASE_URL` to the container's `DATABASE_URL`; it deliberately does
not read a development `DATABASE_URL`, which points at `localhost` and is wrong inside a
container. Two consequences worth knowing:

- The bundled `db` service stays in the stack, and `migrate`, `app`, and `backup` wait for
  it to become healthy before starting, even when the app itself talks to the managed
  endpoint. Leave it idle, or stop it after the stack is up with `docker compose stop db`.
- Attachments, the stored password, and `/data/backups` remain on the `kbs_data` volume.
  A managed database does not move them.

Without containers, set `DATABASE_URL` in the host's environment and run the same
commands from the repository.

## Migration ordering

- `drizzle/` holds 24 migrations with their order in `drizzle/meta/_journal.json`.
  `npm run db:migrate` applies the unapplied ones in journal order and records each in
  `__drizzle_migrations`.
- Migrations are **forward-only**: there are no `down` files. Rolling back means
  restoring a snapshot and deploying the app version that matches it. Never run an older
  build against a newer schema.
- In the stack, `migrate` runs to completion and `app` waits for it
  (`depends_on: condition: service_completed_successfully`). A release never serves a new
  version against an old schema, and a failed migration keeps the app from starting at
  all — which is the intended failure mode.
- Manual release without compose: take a snapshot → `npm run db:migrate` →
  `npm run db:check` → start the new version → sign in and search.
- Never run `db:generate` in production. It writes new migration files and belongs in
  development, where the files are reviewed and committed.
- Run migrations from exactly one place. Two concurrent `db:migrate` runs against the
  same database are not coordinated.
- Migrations run in a transaction, and a failed migration is not recorded, so rerunning
  after fixing the cause is safe. If a migration fails partway through a release, do not
  start the app; fix forward with a new migration, or restore the pre-migration snapshot.
- `pg_trgm` is the one migration that needs a permission beyond ordinary DDL. If the role
  cannot create the extension, the migration fails before any index exists; create it as
  an administrator and rerun.

## First deployment, end to end

```bash
# 1. Provision the database. Note the direct endpoint, the pooled endpoint,
#    and whether the provider uses a private CA.
# 2. Write the host-only .env shown above; never commit it.
# 3. Validate the file without printing secrets.
docker compose config --quiet

# 4. Build and start. migrate must finish before app starts.
docker compose up -d --build
docker compose logs migrate            # "migrations applied successfully"

# 5. Check the app's own connection and schema through the migration image.
docker compose run --rm migrate npm run db:check

# 6. Check the gate before signing in.
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/pages   # 401

# 7. In the browser: sign in with KBS_AUTH_PASSWORD, create a page, upload an
#    attachment, then search for a word of three or more characters so the
#    trigram indexes are exercised.

# 8. Confirm the first verified backup.
docker compose logs backup

# 9. Copy backups off the volume and enable the provider's automated backups or
#    point-in-time recovery.
```

If TLS is misconfigured, step 4 fails at `migrate` with a certificate error and `app`
never starts, so nothing serves a half-migrated schema.

## Verifying a managed deployment

- `docker compose logs migrate` ends with a successful migration run, and
  `npm run db:check` connects.
- An unauthenticated `/api/*` request returns `401` and a page request redirects to
  `/signin`; signing in returns the expected workspace.
- A page with an attachment renders after upload — that proves the volume, not the
  database.
- Search finds a phrase from a page created after the migration, which is what the trigram
  indexes back.
- `docker compose logs backup` shows a verified run, and the folder appears under
  `/data/backups` on the host volume.
- `docker compose ps` reports `app` as healthy. The healthcheck requests `/signin`, so a
  `503` there means the auth variables are missing or the secret is short.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `unable to verify the first certificate` or `SELF_SIGNED_CERT_IN_CHAIN` | Private CA not supplied | Append `sslrootcert=<path>` and mount the bundle in `app`, `migrate`, and `backup` |
| `Hostname/IP does not match certificate's altnames` | Certificate issued for a different hostname | Use the provider's endpoint hostname, or the pooled/direct host that matches the certificate |
| `permission denied to create extension "pg_trgm"` | Role cannot install extensions | Create it once as an administrator, then rerun `npm run db:migrate` |
| `too many connections` | App pool (10) plus jobs against the plan's cap | Use the pooled endpoint for the app, or a larger plan |
| Connection timeout or `ENOTFOUND` on the direct endpoint | Private networking or IP family mismatch | Check the provider's network requirements, or use the pooled host |
| Migration fails and `app` will not start | The new schema did not apply | Inspect `docker compose logs migrate`; fix forward or restore the snapshot, then redeploy |
| `database "..." does not exist` | Wrong database name in the URL | Use the database the provider created; the URL's path is the database name |

## What this does not move

Attachments (`/data/attachments`), the password set in Settings
(`/data/auth-credential.json`), and backups (`/data/backups`) live on the app's volume.
A managed database gives durability and point-in-time recovery for rows only, so keep the
volume backed up and copy backups off the host; see
[backup and restore](backup-and-restore.md).
