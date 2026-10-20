"""Run existing DB tests on disposable PostgreSQL 16, never on Compose data.

Uses local images, no published ports, no persistent volumes, no external network.
Requires Docker access. Execute from the project root with Python 3.
"""
import pathlib
import subprocess
import time
import uuid

root = pathlib.Path(__file__).resolve().parents[2]
name = 'startup-audit-' + uuid.uuid4().hex[:12]
def call(args, **kwargs):
    return subprocess.run(['docker', *args], check=True, **kwargs)

call(['run', '-d', '--name', name, '--network', 'none',
      '--tmpfs', '/var/lib/postgresql/data',
      '-e', 'POSTGRES_USER=startup', '-e', 'POSTGRES_PASSWORD=isolated-audit-only',
      '-e', 'POSTGRES_DB=startup_test_audit', 'postgres:16-alpine'])
try:
    for _ in range(30):
        ready = subprocess.run(['docker', 'exec', name, 'pg_isready', '-U', 'startup',
                                '-d', 'startup_test_audit'], capture_output=True)
        if ready.returncode == 0:
            break
        time.sleep(1)
    else:
        raise RuntimeError('Disposable PostgreSQL did not become ready')
    url = 'postgresql+psycopg://startup:isolated-audit-only@127.0.0.1:5432/startup_test_audit'
    call(['run', '--rm', '--network', 'container:' + name,
          '--mount', f'type=bind,source={root},target=/app,readonly',
          '--workdir', '/app', '-e', 'PYTHONPATH=/app/backend',
          '-e', 'DATABASE_URL=' + url, '-e', 'TEST_DATABASE_URL=' + url,
          '--entrypoint', 'sh', 'startup_team_demo_macos-api', '-c',
          'alembic -c /app/backend/alembic.ini upgrade head && '
          'python -m pytest -q -p no:cacheprovider backend/tests/test_integration_postgres.py '
          'backend/tests/test_db_integrity_postgres.py'])
finally:
    call(['rm', '-f', name])
