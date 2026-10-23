#!/usr/bin/env bash
# macOS + Docker Desktop. Run from anywhere: bash tools/test_on_macos.sh
# Verifies the application and runs destructive integration tests ONLY in a
# newly created, randomly named disposable PostgreSQL database.
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

usage() {
  cat <<'HELP'
Usage: bash tools/test_on_macos.sh [--skip-build] [--skip-integration]
  --skip-build        Reuse already built images
  --skip-integration  Skip PostgreSQL integration tests (not recommended)
HELP
}
SKIP_BUILD=0
SKIP_INTEGRATION=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=1 ;;
    --skip-integration) SKIP_INTEGRATION=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo 'This script is intended for macOS. Use tools/test_on_linux.sh on Linux.' >&2
  exit 1
fi
command -v docker >/dev/null 2>&1 || {
  echo 'Docker CLI not found. Install Docker Desktop for Mac and open it.' >&2
  exit 1
}
if ! docker info >/dev/null 2>&1; then
  echo 'Docker Engine is not running. Start Docker Desktop and wait until it is ready.' >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo 'Docker Compose v2 is missing. Update Docker Desktop.' >&2
  exit 1
fi
command -v curl >/dev/null 2>&1 || { echo 'curl is missing.' >&2; exit 1; }
command -v uuidgen >/dev/null 2>&1 || { echo 'uuidgen is missing.' >&2; exit 1; }

# Avoid accidental reuse of a different project's Compose state.
# The project name is fixed for this macOS demo and kept independent of
# other Compose projects on the machine.
export COMPOSE_PROJECT_NAME=startup_team_demo_macos

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo 'Created .env with DEMO credentials; app is bound to 127.0.0.1 only.'
fi

web_port=$(sed -nE 's/^[[:space:]]*WEB_PORT[[:space:]]*=[[:space:]]*([0-9]+).*/\1/p' .env | tail -n 1)
web_port=${web_port:-8080}
if ! [[ "$web_port" =~ ^[0-9]+$ ]] || (( 10#$web_port < 1 || 10#$web_port > 65535 )); then
  echo "Invalid WEB_PORT: $web_port" >&2
  exit 1
fi

echo '=== Check Docker Compose configuration ==='
docker compose config --quiet

echo '=== Build and start local project ==='
if (( SKIP_BUILD )); then
  docker compose up -d
else
  docker compose up --build -d
fi
docker compose ps

health_url="http://127.0.0.1:$web_port/readyz"
echo "=== Wait for API health at $health_url ==="
ready=0
for (( i=0; i<45; i++ )); do
  if curl --fail --silent --max-time 3 "$health_url" | grep -q '"status":"ok"'; then
    ready=1
    break
  fi
  sleep 2
done
if (( ! ready )); then
  echo 'FAILED: web/API did not become healthy. Recent container logs:' >&2
  docker compose logs --tail=80 api web db >&2 || true
  exit 1
fi
echo 'PASS: API health check'

echo '=== Static/contract tests inside the API container ==='
docker compose exec -T api pytest -q \
  /app/backend/tests/test_contract.py \
  /app/backend/tests/test_review_contract.py

if (( SKIP_INTEGRATION )); then
  echo 'WARNING: PostgreSQL integration tests were skipped.'
else
  # Compose test database is deliberately distinct from startup and never reused.
  uuid=$(uuidgen)
  uuid=${uuid//-/}
  uuid=$(printf '%s' "$uuid" | tr '[:upper:]' '[:lower:]')
  db_name="startup_test_${uuid:0:12}"
  [[ "$db_name" =~ ^startup_test_[a-f0-9]{12}$ ]] || {
    echo 'Failed to generate safe disposable DB identifier.' >&2
    exit 1
  }
  created=0
  cleanup_test_db() {
    if (( created )); then
      echo "=== Clean up disposable test database: $db_name ==="
      docker compose exec -T db psql -U startup -d postgres \
        -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $db_name WITH (FORCE);" \
        || echo "WARNING: Could not drop disposable $db_name" >&2
    fi
  }
  trap cleanup_test_db EXIT

  echo "=== Create isolated PostgreSQL test database: $db_name ==="
  docker compose exec -T db psql -U startup -d postgres \
    -v ON_ERROR_STOP=1 -c "CREATE DATABASE $db_name;"
  created=1

  echo '=== Apply migrations to disposable DB and run integration tests ==='
  docker compose exec -T -e "INTEGRATION_DB_NAME=$db_name" api python - <<'PY'
import os
import subprocess
from sqlalchemy.engine import make_url

original = make_url(os.environ['DATABASE_URL'])
db_name = os.environ['INTEGRATION_DB_NAME']
assert db_name.startswith('startup_test_')
url = original.set(database=db_name)
os.environ['DATABASE_URL'] = url.render_as_string(hide_password=False)
os.environ['TEST_DATABASE_URL'] = os.environ['DATABASE_URL']
subprocess.run(['alembic', '-c', '/app/backend/alembic.ini', 'upgrade', 'head'], check=True)
subprocess.run([
    'pytest', '-q',
    '/app/backend/tests',
], check=True)
PY
  cleanup_test_db
  created=0
  trap - EXIT
fi

echo
echo "PASS: Startup Team local checks finished. Open http://127.0.0.1:$web_port"
echo 'Demo logins: ivan@example.test / demo-ivan-123; maria@example.test / demo-maria-123'
echo 'Manual browser walkthrough is still required; other unimplemented features remain unverified.'
echo 'Stop containers without deleting the database: docker compose down'
