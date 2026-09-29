# Production: robo-factory.ru

The production stack uses `docker-compose.prod.yml` independently of the local development stack. Only Caddy publishes ports 80 and 443. PostgreSQL, the API and frontend communicate over the private Docker network.

## Server layout

```text
/opt/robo-factory/
  bin/deploy.sh
  incoming/<commit>.tar.gz
  releases/<commit>/
  current -> releases/<commit>
  previous -> releases/<previous-successful-commit>
  shared/.env
  shared/datasets/
  shared/deployed-sha
  backups/
```

The `deploy` user owns this directory and runs Docker. The GitHub deployment key is separate from the operator key. SSH host keys are pinned, not scanned during each workflow run.

## First deployment

1. Install Docker Engine and the Compose plugin on Ubuntu. Create `deploy` with Docker access and its dedicated SSH public key.
2. Create the server directories above. Copy `deploy/production.env.example` to `shared/.env`, replace the secrets, and set file permissions to 600.
3. Copy a Git archive of the desired commit to `incoming/<commit>.tar.gz`; extract it to `releases/<commit>/` and install `deploy/deploy.sh` in `bin/`.
4. Start only PostgreSQL. Restore the current local database using `pg_restore` and the uploaded backup. Restore the `uploads` volume from its archive before starting the API. Keep the database and uploads snapshots together.
5. Change the existing demo account passwords in the restored database. Changing environment variables alone does not change previously stored password hashes. Production disables automatic demo seeding.
6. Run `bash /opt/robo-factory/bin/deploy.sh <commit>`.
7. Point the domain A record to the server. Caddy issues HTTPS automatically when the domain resolves and ports 80/443 are reachable. The HTTP IP address remains available during initial DNS registration.

## GitHub Actions

Repository secrets: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` (dedicated private key), `DEPLOY_KNOWN_HOSTS` (verified server host key).

Every push to `main`, or a manual **Deploy production** run, uploads the exact commit, builds the images on the server, saves a database backup, runs migrations and waits for the application health checks. Concurrent deployments are serialized. No database credentials or backups are transferred through Actions.

PostgreSQL data, uploaded photos, documents and TLS certificates live in persistent named volumes. Code deployment does not replace these volumes or import catalog data. Catalog/data updates should be performed explicitly after reviewing the dataset manifests.

## Operations

```bash
cd /opt/robo-factory/current
export IMAGE_TAG=$(cat /opt/robo-factory/shared/deployed-sha)
docker compose --env-file /opt/robo-factory/shared/.env -f docker-compose.prod.yml ps
docker compose --env-file /opt/robo-factory/shared/.env -f docker-compose.prod.yml logs --tail 100 backend
```

Keep off-server copies of database backups and uploaded files. Provider snapshots complement logical PostgreSQL backups. Review disk usage and retain the required rollback images and database snapshots; deployments do not delete application data.

`previous` identifies the last successful release. Rollback is manual because reverting application code after an incompatible database migration may require restoring the corresponding database snapshot. A failed deployment preserves containers and its backup for diagnosis.
