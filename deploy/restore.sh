#!/usr/bin/env bash
# Restauration d'une sauvegarde sur une pile vide :  deploy/restore.sh <db-AAAAMMJJ-HHMMSS.dump> <media-AAAAMMJJ-HHMMSS.tar.gz>
# ATTENTION : remplace la base et les médias actuels. Non testé (Docker absent de la machine de développement).
set -euo pipefail

DB_DUMP="${1:?usage: restore.sh <db.dump> <media.tar.gz>}"
MEDIA_TAR="${2:?usage: restore.sh <db.dump> <media.tar.gz>}"
COMPOSE="docker compose -f deploy/docker-compose.yml --env-file deploy/prod.env"

read -r -p "Remplacer la base et les médias actuels ? (oui/non) " ANSWER
[ "$ANSWER" = "oui" ] || { echo "Annulé."; exit 1; }

$COMPOSE stop api
$COMPOSE exec -T db pg_restore -U caselind -d caselind --clean --if-exists --no-owner < "$DB_DUMP" || echo "pg_restore a signalé des avertissements (souvent sans gravité) : relisez les lignes ci-dessus."
$COMPOSE run --rm -T --no-deps --entrypoint sh api -c 'rm -rf /data/media/* && tar -C /data -xzf -' < "$MEDIA_TAR"
$COMPOSE up -d api
echo "Restauration terminée."
