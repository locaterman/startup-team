#!/usr/bin/env bash
# Linux verification in an exclusively disposable Docker Compose project.
# Never reuses the checkout's .env, default Compose project, database or volume.
set -Eeuo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

usage() {
  echo "Usage: bash tools/test_on_linux.sh [--skip-build] [--skip-integration]"
}
skip_build=0
skip_integration=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) skip_build=1 ;;
    --skip-integration) skip_integration=1 ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

for executable in docker python3 openssl curl; do
  command -v "$executable" >/dev/null 2>&1 ||
    { echo "Missing prerequisite: $executable" >&2; exit 1; }
done
docker info >/dev/null || { echo 'Docker Engine is not available.' >&2; exit 1; }
docker compose version >/dev/null

# No user-provided .env, COMPOSE_PROJECT_NAME, WEB_PORT or public host ports.
# Every invocation gets its own project, database, volume and loopback port.
umask 077
suffix="$(openssl rand -hex 6)"
project="startup_team_verify_$suffix"
test_db="startup_test_$suffix"
web_port="$(python3 - <<'PY'
import socket
with socket.socket() as server:
    server.bind(('127.0.0.1', 0))
    print(server.getsockname()[1])
PY
)"
[[ "$project" =~ ^startup_team_verify_[a-f0-9]{12}$ ]] || exit 1
[[ "$test_db" =~ ^startup_test_[a-f0-9]{12}$ ]] || exit 1
[[ "$web_port" =~ ^[0-9]+$ ]] || exit 1

# Fail closed on even an extremely unlikely project-name collision.
if [[ -n "$(docker ps -aq --filter "label=com.docker.compose.project=$project")" ]] ||
   [[ -n "$(docker volume ls -q --filter "label=com.docker.compose.project=$project")" ]]; then
  echo "Refusing to reuse existing Compose project: $project" >&2
  exit 1
fi

password="$(openssl rand -hex 24)"
csrf_secret="$(openssl rand -hex 32)"
verify_env="$(mktemp "${TMPDIR:-/tmp}/startup-team-verify.XXXXXXXX")"
{
  printf 'POSTGRES_PASSWORD=%s\n' "$password"
  printf 'CSRF_SECRET=%s\n' "$csrf_secret"
  printf 'WEB_PORT=%s\n' "$web_port"
  printf 'ALLOW_DEMO_LOGIN=true\nSEED_DEMO_ACCOUNTS=true\nCOOKIE_SECURE=false\n'
  printf 'TELEGRAM_BOT_TOKEN=\nTELEGRAM_AUTH_MAX_AGE_SECONDS=300\n'
} > "$verify_env"

compose() {
  # Explicit overrides defeat exported caller variables; -f/-p defeat
  # COMPOSE_FILE/COMPOSE_PROJECT_NAME. Only the disposable project is addressed.
  env -u COMPOSE_FILE -u COMPOSE_PROFILES \
    POSTGRES_PASSWORD="$password" CSRF_SECRET="$csrf_secret" WEB_PORT="$web_port" \
    ALLOW_DEMO_LOGIN=true SEED_DEMO_ACCOUNTS=true COOKIE_SECURE=false \
    TELEGRAM_BOT_TOKEN= TELEGRAM_AUTH_MAX_AGE_SECONDS=300 \
    docker compose --env-file "$verify_env" -f "$ROOT/compose.yaml" -p "$project" "$@"
}

may_have_created_resources=0
cleanup() {
  status=$?
  trap - EXIT INT TERM
  if (( may_have_created_resources )); then
    echo "=== Removing ONLY disposable Compose project: $project ==="
    if ! compose down -v --remove-orphans; then
      echo "WARNING: cleanup failed for disposable project $project" >&2
      (( status != 0 )) || status=1
    fi
  fi
  rm -f -- "$verify_env"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "=== Isolated Linux test project: $project (127.0.0.1:$web_port) ==="
compose config --quiet
# Mark cleanup required BEFORE 'up': a failed startup can still create volumes.
may_have_created_resources=1
if (( skip_build )); then
  compose up -d
else
  compose up -d --build
fi

ready=0
for (( attempt=0; attempt<45; attempt++ )); do
  if curl -fsS --max-time 3 "http://127.0.0.1:$web_port/readyz" >/dev/null; then
    ready=1
    break
  fi
  sleep 2
done
if (( ! ready )); then
  compose ps
  compose logs --tail=60 api web db >&2 || true
  echo "Isolated API did not become database-ready." >&2
  exit 1
fi

echo '=== Static and contract tests (isolated API container) ==='
compose exec -T api pytest -q /app/backend/tests/test_contract.py /app/backend/tests/test_review_contract.py

if (( ! skip_integration )); then
  echo "=== Disposable PostgreSQL integration database: $test_db ==="
  compose exec -T db psql -U startup -d postgres -v ON_ERROR_STOP=1 \
    -c "CREATE DATABASE $test_db;"
  compose exec -T -e "INTEGRATION_DB_NAME=$test_db" api python - <<'PY'
import os
import subprocess
from sqlalchemy.engine import make_url

database_name = os.environ['INTEGRATION_DB_NAME']
assert database_name.startswith('startup_test_') and len(database_name) == 25
url = make_url(os.environ['DATABASE_URL']).set(database=database_name)
os.environ['DATABASE_URL'] = url.render_as_string(hide_password=False)
os.environ['TEST_DATABASE_URL'] = os.environ['DATABASE_URL']
subprocess.run(['alembic', '-c', '/app/backend/alembic.ini', 'upgrade', 'head'], check=True)
subprocess.run(['pytest', '-q', '/app/backend/tests'], check=True)
PY
else
  echo 'WARNING: integration tests skipped by explicit --skip-integration.'
fi
echo "PASS: isolated Linux verification; $project will be removed with its volumes."
