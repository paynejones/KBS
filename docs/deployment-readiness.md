# Deployment readiness

## Current status

The application builds and its unit and PostgreSQL integration checks pass locally. GitHub Actions is configured to repeat those checks, but it still needs its first run on GitHub.

**Do not expose this application to the public internet yet.** Authentication and authorization are not implemented. The page, database, record, tag, and search APIs currently accept requests without checking a user identity, so anyone who can reach the app can read or change its data.

## Before choosing a host

- Add authentication and enforce ownership/access checks in every API route and server action.
- Decide whether this is single-user or multi-user. Multi-user hosting needs workspace membership and per-workspace data isolation before launch.
- Choose a host that supports the Next.js runtime features used here and a managed PostgreSQL service.
- Confirm how the host provides TLS database connections, secret storage, log retention, and scheduled backups.

## Release checklist

1. Set `DATABASE_URL` in the host's secret manager. Use a dedicated production database and the provider's TLS connection string. Never commit `.env` or production credentials.
2. Provision the production database, then run `npm run db:migrate` as a release step before starting the new application version. Do not run `db:generate` in production.
3. Run the GitHub Actions workflow and require it to pass before deployment. The database job creates and drops a uniquely named test database, so its CI role must be allowed to create databases.
4. Build with `npm ci` and `npm run build`, then start with `npm run start`.
5. Confirm that the deployed service can reach PostgreSQL and that page, database, and search routes return expected results.

## Backups and restore

The supplied `compose.yaml` persists local PostgreSQL data in a Docker volume; a volume is not a backup. For hosted production, enable the database provider's automated backups and point-in-time recovery where available. Set retention to match the recovery objective for the data.

For an additional manual backup with PostgreSQL client tools installed:

```bash
pg_dump --format=custom --file=kbs-backup.dump "$DATABASE_URL"
```

Restore into a separate, empty recovery database first and verify the restored pages and records before using it for cutover:

```bash
pg_restore --no-owner --dbname="$RECOVERY_DATABASE_URL" kbs-backup.dump
```

Practice a restore before launch and periodically afterward. Store backup files outside the app container, restrict access to them, and encrypt them at rest. The repository does not currently schedule backups or automate restore checks.

## Monitoring

API failures currently use `console.error`; they do not include request IDs, structured fields, alerting, or an error-monitoring integration. Before launch, configure host log retention and alerts for application errors, database connectivity, and failed deployments. Add an error tracker and redact request data before sending it; page content can contain private information.

## Remaining launch decisions

- Hosting provider and database provider
- Single-user versus multi-user access model
- Backup retention and recovery-time target
- Error monitoring and alert destination
- Whether the Geist fonts should be self-hosted to remove the build's dependency on Google Fonts availability
