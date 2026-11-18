#!/usr/bin/env bash
# Sauvegarde quotidienne : base PostgreSQL (pg_dump compressé) + volume médias. À lancer par cron sur le serveur, depuis la racine du dépôt :
#   0 3 * * *  cd /opt/caselind && deploy/backup.sh /var/backups/caselind
# Garde 14 jours. Copier le dossier ailleurs (autre serveur ou stockage objet) : une sauvegarde sur le même disque ne protège pas d'une panne du serveur.
# Non testé (Docker absent de la machine de développement).
set -euo pipefail

DEST="${1:?usage: backup.sh <dossier-de-destination>}"
COMPOSE="docker compose -f deploy/docker-compose.yml --env-file deploy/prod.env"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"

$COMPOSE exec -T db pg_dump -U caselind -d caselind --format=custom > "$DEST/db-$STAMP.dump"
$COMPOSE exec -T api tar -C /data -czf - media > "$DEST/media-$STAMP.tar.gz"

find "$DEST" -name 'db-*.dump' -mtime +14 -delete
find "$DEST" -name 'media-*.tar.gz' -mtime +14 -delete
echo "Sauvegarde terminée : $DEST ($STAMP)"
