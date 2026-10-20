#!/usr/bin/env bash
# Local-only development verification on Debian/Ubuntu with Docker Compose.
# Integration tests run against a randomly named disposable database.
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
command -v docker >/dev/null || { echo 'Docker is not installed.' >&2; exit 1; }
docker info >/dev/null || { echo 'Docker Engine is not available.' >&2; exit 1; }
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo 'Created .env from DEVELOPMENT template; do not deploy publicly.'
fi
docker compose config -q
docker compose up --build -d
docker compose ps

echo '=== Static tests ==='
docker compose exec -T api pytest -q /app/backend/tests/test_contract.py /app/backend/tests/test_review_contract.py

name="startup_test_$(tr -dc 'a-f0-9' </dev/urandom | head -c 12 || true)"
[[ "$name" =~ ^startup_test_[a-f0-9]{12}$ ]] || { echo 'Could not generate test DB name' >&2; exit 1; }
created=0
cleanup() {
  if [[ "$created" == 1 ]]; then
    echo "Dropping disposable test database $name"
    docker compose exec -T db psql -U startup -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $name WITH (FORCE);" || echo "WARNING: Failed to drop $name" >&2
  fi
}
trap cleanup EXIT

echo "=== Disposable PostgreSQL integration tests in $name ==="
docker compose exec -T db psql -U startup -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $name;"
created=1
docker compose exec -T -e "INTEGRATION_DB_NAME=$name" api python - <<'PY'
import os, subprocess
from sqlalchemy.engine import make_url
url=make_url(os.environ['DATABASE_URL']).set(database=os.environ['INTEGRATION_DB_NAME'])
os.environ['DATABASE_URL']=url.render_as_string(hide_password=False)
os.environ['TEST_DATABASE_URL']=os.environ['DATABASE_URL']
subprocess.run(['alembic','-c','/app/backend/alembic.ini','upgrade','head'], check=True)
subprocess.run(['pytest','-q', '/app/backend/tests'],check=True)
PY
port=$(grep -E '^WEB_PORT=[0-9]+' .env | tail -1 | cut -d= -f2 || true)
port=${port:-8080}
echo "=== Run complete; open http://localhost:$port on this machine ==="
