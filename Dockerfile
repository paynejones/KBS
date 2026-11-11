# syntax=docker/dockerfile:1

# KBS is one long-lived Next.js server that writes to disk: uploaded attachments,
# the password set in Settings, and backups. It therefore expects a host with a
# persistent volume, not a serverless target. See docs/deployment-readiness.md.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# One runtime identity for every stage that writes to the data volume.
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs

# --- dependencies ----------------------------------------------------------
# The full dependency tree is installed here: the build needs the Tailwind
# loader, and the migration stage needs drizzle-kit, which is a dev dependency.
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# --- production build ------------------------------------------------------
FROM base AS builder
ENV NODE_ENV=production
# src/db/index.ts refuses to load without a connection string and the build
# traces every route, so the build gets a placeholder that is never connected
# to. Override it with --build-arg only if a route ever prerenders real data,
# and prefer a throwaway database over the production one.
ARG DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
ENV DATABASE_URL=${DATABASE_URL}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- schema migrations -----------------------------------------------------
# Run once per release before the new application version starts:
#   docker compose run --rm migrate
FROM base AS migrate
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json /app/tsconfig.json ./
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/src ./src
# `npm run db:check` lives here and is the documented post-migration check.
COPY --from=builder /app/scripts ./scripts
CMD ["npm", "run", "db:migrate"]

# --- scheduled backups -----------------------------------------------------
# Reuses the migration stage's dependency tree, which is where tsx lives, so a
# backup can run inside the stack instead of from a cron entry on the host.
FROM migrate AS backup
# npm writes a cache for `npm run`; a system user has no home directory.
ENV npm_config_cache=/tmp/npm-cache
# The app serves as the same user, so the directory it creates here stays
# writable for the in-app "Back up now" action.
RUN mkdir -p /data/attachments /data/backups \
 && chown -R nextjs:nodejs /data
USER nextjs
CMD ["sh", "scripts/backup-schedule.sh"]

# --- runtime ---------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# The volume is initialised from these directories, so the runtime user owns
# them on a named volume. A bind mount must already be writable by uid 1001.
RUN mkdir -p /data/attachments /data/backups \
 && chown -R nextjs:nodejs /data
USER nextjs
EXPOSE 3000
# The sign-in page is the only route that answers without a session. A 503 means
# authentication is not configured, which must not read as healthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/signin').then((response) => process.exit(response.status < 500 ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]
