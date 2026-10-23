#!/usr/bin/env bash
# Demonstrate pg_dump -> pg_restore against TWO newly created disposable DBs.
# Hard fail on production/Telegram/default Compose projects; never dumps real data.
set -Eeuo pipefail

usage() {
  echo 'Usage: bash tools/verify_postgres_backup_restore.sh <disposable-compose-project>' >&2
  echo 'Allowed: startup_team_browser_ci or startup_team_verify_<12 lowercase hex>' >&2
}
if (( $# != 1 )); then usage; exit 2; fi
project="$1"
if [[ "$project" != startup_team_browser_ci && ! "$project" =~ ^startup_team_verify_[a-f0-9]{12}$ ]]; then
  echo 'REFUSED: backup/restore check is restricted to disposable verification projects.' >&2
  exit 2
fi

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
for binary in docker openssl mktemp; do
  command -v "$binary" >/dev/null || { echo "Missing $binary" >&2; exit 1; }
done
docker info >/dev/null
docker compose version >/dev/null
compose() { docker compose -f "$root/compose.yaml" -p "$project" "$@"; }

# Explicitly inspect the running containers and refuse non-demo configurations.
db_container="$(compose ps -q db)"
api_container="$(compose ps -q api)"
[[ -n "$db_container" && -n "$api_container" ]] ||
  { echo 'Refusing: disposable DB and API must already be running.' >&2; exit 1; }
for pair in "$db_container:db" "$api_container:api"; do
  cid="${pair%%:*}"
  svc="${pair##*:}"
  labels="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}:{{ index .Config.Labels "com.docker.compose.service" }}' "$cid")"
  [[ "$labels" == "$project:$svc" ]] ||
    { echo 'Refusing: Docker container ownership mismatch.' >&2; exit 1; }
done
compose exec -T api python - <<'PY'
import os
from sqlalchemy.engine import make_url

assert make_url(os.environ['DATABASE_URL']).database == 'startup', 'Expected only sandbox default database'
assert os.environ.get('ALLOW_DEMO_LOGIN', '').lower() == 'true', 'Demo login is not enabled'
assert os.environ.get('SEED_DEMO_ACCOUNTS', '').lower() == 'true', 'Demo seeding is not enabled'
PY

umask 077
source_db="startup_test_$(openssl rand -hex 6)"
target_db="startup_test_$(openssl rand -hex 6)"
[[ "$source_db" =~ ^startup_test_[a-f0-9]{12}$ ]] || exit 1
[[ "$target_db" =~ ^startup_test_[a-f0-9]{12}$ && "$source_db" != "$target_db" ]] || exit 1
archive="$(mktemp "${TMPDIR:-/tmp}/startup-backup-restore.XXXXXXXX")"
source_created=0
target_created=0
cleanup() {
  result=$?
  trap - EXIT INT TERM
  if (( target_created )); then
    compose exec -T db psql -U startup -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE $target_db WITH (FORCE);" >/dev/null ||
      { echo "ERROR: unable to drop disposable restore DB $target_db" >&2; result=1; }
  fi
  if (( source_created )); then
    compose exec -T db psql -U startup -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE $source_db WITH (FORCE);" >/dev/null ||
      { echo "ERROR: unable to drop disposable source DB $source_db" >&2; result=1; }
  fi
  rm -f -- "$archive"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo '=== Create separate migration/seeded source and empty restore DBs ==='
compose exec -T db psql -U startup -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $source_db TEMPLATE template0;" >/dev/null
source_created=1
compose exec -T db psql -U startup -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $target_db TEMPLATE template0;" >/dev/null
target_created=1

echo '=== Migrate only synthetic source DB to current Alembic head ==='
compose exec -T -e "BACKUP_SOURCE_DB=$source_db" api python - <<'PY'
import os
import subprocess
from sqlalchemy.engine import make_url

name = os.environ['BACKUP_SOURCE_DB']
url = make_url(os.environ['DATABASE_URL'])
assert url.database == 'startup'
os.environ['DATABASE_URL'] = url.set(database=name).render_as_string(hide_password=False)
subprocess.run(
    ['alembic', '-c', '/app/backend/alembic.ini', 'upgrade', 'head'],
    check=True,
)
PY
compose exec -T api python /app/backend/tests/backup_restore_probe.py seed "$source_db"

echo '=== Create local custom-format archive (temporary, mode 0600) ==='
compose exec -T db pg_dump -U startup -d "$source_db" -Fc --no-owner --no-acl > "$archive"
[[ -s "$archive" ]] || { echo 'ERROR: empty PostgreSQL dump' >&2; exit 1; }
echo '=== Restore into a separately created EMPTY database, one transaction ==='
compose exec -T db pg_restore -U startup -d "$target_db" --no-owner --no-acl --exit-on-error --single-transaction < "$archive"
echo '=== Compare every table, indexes, constraints, triggers and Alembic version ==='
compose exec -T api python /app/backend/tests/backup_restore_probe.py verify "$source_db" "$target_db"
echo 'PASS: synthetic PostgreSQL backup restored with identical schema and data.'
