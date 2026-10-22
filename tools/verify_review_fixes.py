"""Review regressions on disposable PostgreSQL; application databases are never used.

Uses the existing audit dependency image; current sources are mounted read-only.
Run with --regressions-only for the new tests, otherwise run the full backend suite
and the existing independent concurrency/authorization/deadline checks.
"""
from pathlib import Path
import subprocess
import sys
import time
import uuid

root = Path(__file__).resolve().parents[1]
out = root / 'docs/audit/review-fixes-2026-10-21'
out.mkdir(parents=True, exist_ok=True)
name = 'startup-review-fixes-' + uuid.uuid4().hex[:12]


def docker(*args, **kwargs):
    return subprocess.run(['docker', *args], check=True, **kwargs)


docker('run', '-d', '--name', name, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data',
       '-e', 'POSTGRES_USER=startup', '-e', 'POSTGRES_PASSWORD=isolated-review-only',
       '-e', 'POSTGRES_DB=startup_test_independent', 'postgres:16-alpine')
try:
    for _ in range(60):
        if subprocess.run(['docker', 'exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'startup'], capture_output=True).returncode == 0:
            break
        time.sleep(.5)
    else:
        raise RuntimeError('Disposable PostgreSQL did not become ready')
    url = 'postgresql+psycopg://startup:isolated-review-only@127.0.0.1:5432/startup_test_independent'
    regression_only = '--regressions-only' in sys.argv
    target = 'backend/tests/test_review_fixes_postgres.py' if regression_only else 'backend/tests'
    command = ('alembic -c backend/alembic.ini upgrade head && '
               f'python -m pytest -q -p no:cacheprovider {target}')
    if not regression_only:
        command += (' && python tools/verify_contract.py --compare'
                    ' && python -m pytest -q -p no:cacheprovider docs/audit/independent/test_adversarial.py'
                    ' -k "controlled_concurrency or authorization_matrix or independent_deadlines"')
    result = subprocess.run(['docker', 'run', '--rm', '--network', 'container:' + name,
        '--mount', f'type=bind,source={root},target=/app,readonly', '-w', '/app',
        '-e', 'PYTHONPATH=/app/backend:/app/backend/tests', '-e', 'PYTHONDONTWRITEBYTECODE=1',
        '-e', 'DATABASE_URL=' + url, '-e', 'TEST_DATABASE_URL=' + url,
        '--entrypoint', 'sh', 'startup-adversarial-api:20261021', '-c', command], capture_output=True, text=True)
    (out / ('regressions.txt' if regression_only else 'results.txt')).write_text(result.stdout + result.stderr)
    print(result.stdout + result.stderr)
    result.check_returncode()
finally:
    docker('rm', '-f', name)
