#!/bin/sh
# Runs on the deployment host as the last step of a release. Migrations run to
# completion before the application is recreated, so a failed migration leaves
# the previous version serving instead of pointing a new build at an old schema.
#
#   KBS_IMAGE_REPOSITORY=ghcr.io/<owner>/<repo> \
#   KBS_IMAGE_TAG=<commit-sha> \
#   sh scripts/deploy-release.sh
set -eu

: "${KBS_IMAGE_TAG:?KBS_IMAGE_TAG is required: the image tag to release}"

if [ -n "${KBS_IMAGE_REPOSITORY:-}" ]; then
  export KBS_MIGRATE_IMAGE="${KBS_MIGRATE_IMAGE:-${KBS_IMAGE_REPOSITORY}/migrate:${KBS_IMAGE_TAG}}"
  export KBS_APP_IMAGE="${KBS_APP_IMAGE:-${KBS_IMAGE_REPOSITORY}/app:${KBS_IMAGE_TAG}}"
  export KBS_BACKUP_IMAGE="${KBS_BACKUP_IMAGE:-${KBS_IMAGE_REPOSITORY}/backup:${KBS_IMAGE_TAG}}"
fi

echo "[deploy] pulling images for ${KBS_IMAGE_TAG}"
docker compose pull --quiet migrate app backup

echo "[deploy] applying migrations before any new application version starts"
if ! docker compose run --rm migrate; then
  echo "[deploy] migrations failed, so the running version was left in place" >&2
  exit 1
fi

echo "[deploy] starting the new version"
docker compose up -d --no-build app backup

container=$(docker compose ps -q app)
health=starting
attempts="${DEPLOY_HEALTH_ATTEMPTS:-30}"
interval="${DEPLOY_HEALTH_INTERVAL:-2}"
while [ "$attempts" -gt 0 ]; do
  health=$(docker inspect --format '{{.State.Health.Status}}' "$container" 2>/dev/null || echo unknown)
  [ "$health" = "healthy" ] && break
  attempts=$((attempts - 1))
  [ "$attempts" -gt 0 ] && sleep "$interval"
done

if [ "$health" != "healthy" ]; then
  echo "[deploy] app did not become healthy (last status: ${health:-none})" >&2
  docker compose logs --tail 40 app >&2
  exit 1
fi

echo "[deploy] ${KBS_IMAGE_TAG} is live"
