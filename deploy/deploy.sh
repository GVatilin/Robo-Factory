#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

BASE=/opt/robo-factory
SHA=${1:?Usage: deploy.sh COMMIT_SHA}
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "Invalid commit SHA" >&2; exit 2; }
RELEASE="$BASE/releases/$SHA"
ARCHIVE="$BASE/incoming/$SHA.tar.gz"
ENV_FILE="$BASE/shared/.env"
test -s "$ENV_FILE"
test -s "$ARCHIVE"
exec 9>"$BASE/deploy.lock"
flock -w 1200 9

if [[ ! -f "$RELEASE/.extracted" ]]; then
    mkdir -p "$RELEASE"
    tar -xzf "$ARCHIVE" -C "$RELEASE" --no-same-owner
    touch "$RELEASE/.extracted"
fi
export IMAGE_TAG="$SHA"
compose() { docker compose --env-file "$ENV_FILE" -f "$RELEASE/docker-compose.prod.yml" "$@"; }
compose config --quiet
compose build backend frontend

# Keep a database snapshot before every schema migration. Files stay on this server.
if compose ps --status running --services | grep -qx db; then
    mkdir -p "$BASE/backups"
    BACKUP="$BASE/backups/$(date -u +%Y%m%dT%H%M%SZ)-$SHA.dump"
    compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$BACKUP.tmp"
    mv "$BACKUP.tmp" "$BACKUP"
fi

PREVIOUS=$(readlink -f "$BASE/current" || true)
if ! compose up -d --wait --wait-timeout 240; then
    echo "Deployment failed. Containers are retained for diagnosis; database was not reset." >&2
    compose logs --tail 60 backend frontend >&2
    exit 1
fi
compose exec -T frontend wget -q -O /dev/null http://127.0.0.1/api/health
# Reviewed new products and their assets are applied once, preserving later edits.
for package in "$RELEASE"/datasets/catalog_expansion_*/bundle.json; do
    [[ -s "$package" ]] || continue
    package_name=$(basename "$(dirname "$package")")
    compose run --rm --no-deps --user root --entrypoint python \
        -v "$RELEASE/datasets:/catalog-data:ro" backend /catalog-data/load_catalog_expansion.py \
        --package "/catalog-data/$package_name"
done
# Curated logo assets travel with the release; repeat imports are idempotent.
if [[ -s "$RELEASE/datasets/manufacturer_logos/manifest.json" ]]; then
    compose run --rm --no-deps --user root --entrypoint python \
        -v "$RELEASE/datasets:/logo-data:ro" backend /logo-data/load_manufacturer_logos.py
fi
[[ -z "$PREVIOUS" ]] || ln -sfn "$PREVIOUS" "$BASE/previous"
if [[ -s "$RELEASE/datasets/manufacturer_descriptions.json" ]]; then
    compose run --rm --no-deps --user root --entrypoint python \
        -v "$RELEASE/datasets:/description-data:ro" backend /description-data/load_manufacturer_descriptions.py
fi
ln -sfn "$RELEASE" "$BASE/current"
install -m 700 "$RELEASE/deploy/deploy.sh" "$BASE/bin/deploy.sh.next"
mv "$BASE/bin/deploy.sh.next" "$BASE/bin/deploy.sh"
printf '%s\n' "$SHA" > "$BASE/shared/deployed-sha"
echo "Deployed $SHA"

# Remove only dangling build data; all volumes and tagged rollback images are retained.
docker builder prune --force --filter 'until=168h' >/dev/null || true
