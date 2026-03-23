#!/bin/bash

CONTAINER=postgis-mvt
DB=aquametric
USER=postgres

echo "📤 Taking backup..."

docker exec $CONTAINER pg_dump \
  -U $USER \
  -Fc \
  $DB > ../backups/latest.dump

echo "✅ Backup updated at $(date)"