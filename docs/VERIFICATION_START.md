# First real execution — v0.3

## Run on Windows with Docker Desktop

1. Extract the ZIP into a project directory. In PowerShell, `cd` to that directory.
2. Start Docker Desktop; wait until Docker Engine is running.
3. From the project root, run:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\tools\test_on_windows.ps1
   ```

   Or with PowerShell 7: `pwsh -File .\tools\test_on_windows.ps1`.

The script verifies Docker availability, creates a local `.env` if missing, builds the backend/frontend images, starts PostgreSQL, validates the API, runs static tests, then creates a **randomly named temporary database** for real PostgreSQL migrations and integration tests. It drops the temporary database afterward, even on test failure. It will NOT erase the main `startup` database. A test failure is expected to stop the script and show an error.

When successful, visit `http://localhost:8080` (or `WEB_PORT` from `.env`). Test `ivan@example.test` / `demo-ivan-123` and `maria@example.test` / `demo-maria-123`. Do **not** expose this development deployment publicly.

To see logs, run:

```powershell
docker compose ps
docker compose logs --tail=100 api
docker compose logs --tail=100 web
```

**Important:** Before sharing logs, redact secrets/passwords. Do not run integration tests manually against a database containing real or important data; the test fixtures truncate tables.

## Environment-independent findings

- Static tests were run without PostgreSQL: 7 passed, 2 skipped (the skipped modules require `TEST_DATABASE_URL`).
- `tools/verify_contract.py --compare` found 60 matching API methods.
- v0.2 backend image `requirements.txt` lacked `PyYAML`, even though its static tests import `yaml`. Added `PyYAML>=6,<7` in v0.3.
- Live PostgreSQL migration and UI build remain **not verified** in this execution environment: Docker/PostgreSQL are absent and npm registry resolution failed.
- A complete manual browser walkthrough is still required; this script does not certify every feature.

## Alternative: Debian/Ubuntu host with Docker Compose

From an extracted copy of the project, with Docker Engine and Compose installed:

```bash
bash tools/test_on_linux.sh
```

This also uses a randomly named disposable PostgreSQL database and deletes it after the tests. It does not open the app publicly; the sample compose port binding is host-wide, so on a shared or internet-facing server restrict `web.ports` to loopback or use firewalling **before** running. Set a free `WEB_PORT` in `.env` if 8080 is occupied. This Linux script has not been executed in this environment.
