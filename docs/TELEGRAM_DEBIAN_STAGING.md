# Первоначальное развёртывание Telegram Mini App на Debian

> **История первого развёртывания.** 23 октября 2026 приложение уже работало по адресу https://startup.locatermanhass.ru/ через бота [@test_q_buisness_club_bot](https://t.me/test_q_buisness_club_bot). Также вручную проверено сообщение о новом отклике. Ниже сохранены первоначальные шаги настройки отдельного Docker-окружения и Caddy. Это не универсальная инструкция повторного запуска: на работающем сервере уже настроены домен, секреты и отдельный PostgreSQL-том. Актуальный обзор проекта есть в [README](../README.md).

The intended hostname is **startup.locatermanhass.ru** and bot is
**@test_q_buisness_club_bot**. The source has server-side signed `initData`
verification, onboarding and CSRF protection. **Nothing in this runbook
implies DNS, HTTPS or BotFather is already configured.**

## Isolation and safety

- Live legacy/demo: Compose `startup_team`, loopback **18080** — untouched.
- Existing visual preview: Compose `startup_team_acceptance`, loopback **18086** — untouched.
- New Telegram-only app: Compose **`startup_team_telegram`**, loopback
  **18087**, its own PostgreSQL Docker volume and fresh users/projects.
- Existing Debian **host Caddy** keeps 80/443. Never use
  `compose.production.yaml` on this host; it starts another Caddy and
  attempts to bind 80/443.
- In the new deployment, `COOKIE_SECURE=true`,
  `ALLOW_DEMO_LOGIN=false`, `SEED_DEMO_ACCOUNTS=false`.
  The Telegram token is an on-host chmod-600 file, mounted read-only in
  the API container rather than interpolated into Compose config.
- Do NOT copy demo users or their project ownership automatically.
  Existing Ivan/Maria demo projects from 18086 will not appear under new
  signed Telegram identities. User migration would require explicit work.

## Step 1: prepare Telegram-only stack locally on Debian

From Mac (one-time; SSH TTY is needed to privately enter token):

```bash
ssh -t loc@192.168.1.10 'bash -lc '\''set -Eeuo pipefail
cd ~/startup-team-ui-check
test -z "$(git status --porcelain)" || { echo "Local Git changes: not updating checkout"; exit 1; }
git fetch origin chatgpt/complete-api-integration
git switch --detach FETCH_HEAD
bash deploy/start-telegram-staging.sh'\''
```

The script prompts for the existing BotFather token **without echoing it**.
Retrieve it privately from BotFather if needed; NEVER send it into this
chat, terminal screenshots, a command argument, or GitHub.

Server-private values are stored only in
`~/.config/startup-team-telegram/server.env` and
`~/.config/startup-team-telegram/bot-token` with restrictive file
permissions. Re-running is safe: secrets and volume are reused.

The script checks the local `http://127.0.0.1:18087/healthz` and requires
`/api/v1/auth/config` to report Telegram enabled and demo disabled. A
normal desktop browser cannot perform Telegram login; that is expected.

## Step 2: host routing and HTTPS (not automatic)

Before editing existing Caddy, verify that the hostname can actually
reach the Debian host through Cloudflare and the existing connection.
For direct public DNS/Caddy, this typically requires suitable DNS
records and externally reachable ports 80/443. A Cloudflare Tunnel uses
different ingress/routing; do not add router port forwarding when using
a tunnel. Do not silently assume either is configured.

The intended site block is in `deploy/host-caddy.telegram.caddy`:

```caddyfile
startup.locatermanhass.ru {
    encode zstd gzip
    reverse_proxy 127.0.0.1:18087
    header {
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}
```

**Do not overwrite the existing host Caddyfile.** Inspect it first:

```bash
ssh loc@192.168.1.10 'sudo cat /etc/caddy/Caddyfile'
```

If there is no existing rule for `startup.locatermanhass.ru`, back up
the current file, install/import the site block, validate the resulting
configuration and reload the existing service:

```bash
ssh -t loc@192.168.1.10 'bash -se' <<'REMOTE'
set -Eeuo pipefail
cd ~/startup-team-ui-check
sudo cp -a /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.backup.$(date +%Y%m%d%H%M%S)"
sudo install -m 644 deploy/host-caddy.telegram.caddy /etc/caddy/startup-team.telegram.caddy
if ! sudo grep -Fq 'import /etc/caddy/startup-team.telegram.caddy' /etc/caddy/Caddyfile; then
  printf '\nimport /etc/caddy/startup-team.telegram.caddy\n' |
    sudo tee -a /etc/caddy/Caddyfile >/dev/null
fi
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl reload caddy
REMOTE
```

Do NOT use these commands if the domain already has a Caddy site block:
adapt the existing block instead. If validation fails, **do not reload**;
restore the backed-up Caddyfile first.

Verify only after the hostname is available externally:

```bash
curl -fI https://startup.locatermanhass.ru/
curl -fsS https://startup.locatermanhass.ru/api/v1/auth/config
```

The config endpoint should return Telegram enabled and demo disabled.
HTTP alone or an invalid certificate is not acceptable for Mini App
launch or Secure cookies.

## Step 3: BotFather

Once the real HTTPS URL works, open **@BotFather** → `/mybots` →
`@test_q_buisness_club_bot` → Bot Settings → Main Mini App (the menu
labels may vary). Set:

```text
https://startup.locatermanhass.ru
```

Optionally configure the bot chat menu button via `/setmenubutton`,
with a label such as “Открыть стартапы”. Main Mini App launch is
recommended because it supplies real signed `initData`. Verify using
the actual Telegram client, not by pasting `initData` into a browser.

On the first open, complete the profile. Later opens should preserve
the same Telegram identity, project ownership and session. The
existing demo account is deliberately not auto-linked to this identity.

## Updating just this separate Telegram deployment

After the first setup, with secrets and volume already present:

```bash
ssh -t loc@192.168.1.10 'bash -lc '\''set -Eeuo pipefail
cd ~/startup-team-ui-check
test -z "$(git status --porcelain)"
git fetch origin chatgpt/complete-api-integration
git switch --detach FETCH_HEAD
bash deploy/start-telegram-staging.sh'\''
```

No `docker compose down -v`, no volume deletion, no main-branch merge,
and no interruption of 18080 or 18086. Keep the original Caddy service
running throughout.

## References

- Telegram Mini Apps: https://core.telegram.org/bots/webapps
- Caddy reverse proxy: https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
- Existing auth implementation: `docs/TELEGRAM_SETUP.md`
