#!/usr/bin/env bash
# Start an independent Telegram-only backend (port 18087) on Debian.
# Run interactively over SSH; NEVER paste a BotFather token in chat.
set -Eeuo pipefail
umask 077

ROOT="$(cd -- "$(dirname -- "$0")/.." && pwd)"
SECRETS="$HOME/.config/startup-team-telegram"
ENV_FILE="$SECRETS/server.env"
TOKEN_FILE="$SECRETS/bot-token"
PROJECT="startup_team_telegram"
PORT=18087

cd "$ROOT"
for name in docker curl openssl python3; do
  command -v "$name" >/dev/null || { echo "Missing: $name" >&2; exit 1; }
done
docker compose version >/dev/null
test -f compose.yaml && test -f deploy/compose.telegram-staging.yaml

# Never put secrets inside a Git worktree or into Compose command output.
mkdir -p "$SECRETS"
chmod 700 "$SECRETS"
if [[ ! -s "$TOKEN_FILE" ]]; then
  if [[ ! -t 0 ]]; then
    echo "Start with ssh -t so the BotFather token can be entered privately." >&2
    exit 1
  fi
  printf '\nBotFather token (hidden input; it stays only on Debian): '
  IFS= read -r -s token
  printf '\n'
  if [[ ! "$token" =~ ^[0-9]+:[A-Za-z0-9_-]{25,}$ ]]; then
    echo "BotFather token format invalid. Nothing written." >&2
    exit 1
  fi
  printf '%s\n' "$token" > "$TOKEN_FILE"
  unset token
  chmod 600 "$TOKEN_FILE"
fi

if [[ ! -s "$ENV_FILE" ]]; then
  {
    printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 32)"
    printf 'CSRF_SECRET=%s\n' "$(openssl rand -hex 32)"
    printf 'WEB_PORT=18087\n'
    printf 'TELEGRAM_SECRET_PATH=%s\n' "$TOKEN_FILE"
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
fi

# Explicitly reject misconfiguration; never accidentally replace another app.
if ! grep -Fxq 'WEB_PORT=18087' "$ENV_FILE"; then
  echo "Refusing to start: private env must bind WEB_PORT=18087." >&2
  exit 1
fi
if ! grep -Fxq "TELEGRAM_SECRET_PATH=$TOKEN_FILE" "$ENV_FILE"; then
  echo "Refusing to start: unexpected Telegram token path." >&2
  exit 1
fi
if grep -Eq '^(ALLOW_DEMO_LOGIN|SEED_DEMO_ACCOUNTS|COOKIE_SECURE)=' "$ENV_FILE"; then
  echo "Remove security mode overrides from private env: the overlay enforces them." >&2
  exit 1
fi

compose() {
  env -u POSTGRES_PASSWORD -u CSRF_SECRET -u WEB_PORT -u TELEGRAM_SECRET_PATH \
    -u ALLOW_DEMO_LOGIN -u SEED_DEMO_ACCOUNTS -u COOKIE_SECURE \
    docker compose --env-file "$ENV_FILE" \
      -f "$ROOT/compose.yaml" -f "$ROOT/deploy/compose.telegram-staging.yaml" \
      -p "$PROJECT" "$@"
}

echo "=== Building isolated Telegram app (no changes to 18080 or 18086) ==="
compose up -d --build

echo "=== Waiting for local API ==="
healthy=0
for _ in $(seq 1 50); do
  if curl -fsS --max-time 3 "http://127.0.0.1:$PORT/healthz" >/dev/null; then
    healthy=1
    break
  fi
  sleep 2
done
if (( healthy == 0 )); then
  echo "Telegram staging failed to become healthy." >&2
  compose ps
  compose logs --tail=50 api web
  exit 1
fi

# Server must expose Telegram login but not password/demo login.
config="$(curl -fsS --max-time 5 "http://127.0.0.1:$PORT/api/v1/auth/config")"
if ! printf '%s' "$config" | python3 -c '
import json,sys
value=json.load(sys.stdin)
assert value["telegram_enabled"] is True and value["demo_enabled"] is False, value
'; then
  echo "Unexpected auth config: refused to label this staging safe." >&2
  exit 1
fi

echo
compose ps
echo
echo "=== TELEGRAM STAGING READY ==="
echo "Docker project: $PROJECT (independent PostgreSQL volume)"
echo "Web: http://127.0.0.1:$PORT (host-loopback only)"
echo "Telegram-only login: enabled; demo login: disabled; Secure cookies: enabled"
echo "Next: route HTTPS through EXISTING host Caddy, then set BotFather Main Mini App."
echo "Do not use compose.production.yaml: it tries to bind 80/443 itself."
