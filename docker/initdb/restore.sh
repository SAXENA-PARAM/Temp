#!/bin/bash

DUMP_FILE="/backups/latest.dump"
MARKER="/var/lib/postgresql/18/docker/.restored"

if [ -f "$DUMP_FILE" ] && [ ! -f "$MARKER" ]; then
  echo "📦 Restoring database from backup..."
  pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    --no-owner \
    --no-privileges \
    /backups/latest.dump || true
  touch "$MARKER"
  echo "✅ Restore complete!"
else
  echo "⏭️ Skipping restore (already done or no dump found)"
fi