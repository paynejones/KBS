#!/bin/sh
# Runs the workspace backup on an interval inside the container stack. Each run
# writes a dated folder (workspace.json, attachments, manifest.json), verifies
# it, then prunes older copies. A failed run is logged and retried on the next
# interval instead of stopping the schedule.
set -eu

keep="${BACKUP_KEEP:-7}"
interval_hours="${BACKUP_INTERVAL_HOURS:-24}"
run_on_start="${BACKUP_ON_START:-true}"

case "$keep" in
  '' | *[!0-9]*)
    echo "[backup] BACKUP_KEEP must be a whole number, got '$keep'." >&2
    exit 1
    ;;
esac
case "$interval_hours" in
  '' | *[!0-9]*)
    echo "[backup] BACKUP_INTERVAL_HOURS must be a whole number, got '$interval_hours'." >&2
    exit 1
    ;;
esac
[ "$keep" -gt 0 ] || { echo "[backup] BACKUP_KEEP must be at least 1." >&2; exit 1; }
[ "$interval_hours" -gt 0 ] || { echo "[backup] BACKUP_INTERVAL_HOURS must be at least 1." >&2; exit 1; }

interval_seconds=$((interval_hours * 3600))
first_run=1

while :; do
  if [ "$first_run" -eq 1 ] && [ "$run_on_start" != "true" ]; then
    echo "[backup] skipping the startup run; the first backup is in ${interval_hours}h."
  else
    echo "[backup] $(date -u +%Y-%m-%dT%H:%M:%SZ) starting; keeping the $keep most recent."
    if npm run backup -- --keep "$keep"; then
      echo "[backup] finished."
    else
      echo "[backup] this run failed; retrying in ${interval_hours}h." >&2
    fi
  fi

  first_run=0
  sleep "$interval_seconds"
done
