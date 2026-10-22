"""Run auth and domain regressions on disposable PostgreSQL, never the app DB.

Build first: docker build -f backend/Dockerfile -t startup-team-telegram-api:local .
"""
from pathlib import Path
import subprocess
import time
import uuid

root=Path(__file__).resolve().parents[1]
out=root/'docs/audit/telegram-2026-10-21'
out.mkdir(parents=True,exist_ok=True)
name='startup-telegram-check-'+uuid.uuid4().hex[:12]


def docker(*args,**kwargs):
    return subprocess.run(['docker',*args],check=True,**kwargs)


docker('run','-d','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data',
       '-e','POSTGRES_USER=startup','-e','POSTGRES_PASSWORD=isolated-auth-check',
       '-e','POSTGRES_DB=startup_test_independent','postgres:16-alpine')
try:
    for _ in range(60):
        ready=subprocess.run(['docker','exec',name,'pg_isready','-h','127.0.0.1','-U','startup','-d','startup_test_independent'],capture_output=True)
        if ready.returncode==0:break
        time.sleep(.5)
    else:raise RuntimeError('Disposable PostgreSQL did not start')
    url='postgresql+psycopg://startup:isolated-auth-check@127.0.0.1:5432/startup_test_independent'
    command=('alembic -c backend/alembic.ini upgrade head && '
             'python tools/verify_contract.py --compare && '
             'python -m pytest -q -p no:cacheprovider backend/tests && '
             'python -m pytest -q -p no:cacheprovider docs/audit/independent/test_adversarial.py '
             '-k "controlled_concurrency or authorization_matrix or independent_deadlines"')
    result=docker('run','--rm','--network','container:'+name,
                  '--mount',f'type=bind,source={root},target=/app,readonly',
                  '-w','/app','-e','PYTHONPATH=/app/backend','-e','PYTHONDONTWRITEBYTECODE=1',
                  '-e','DATABASE_URL='+url,'-e','TEST_DATABASE_URL='+url,
                  '--entrypoint','sh','startup-team-telegram-api:local','-c',command,
                  capture_output=True,text=True)
    (out/'results.txt').write_text(result.stdout+result.stderr)
    print(result.stdout+result.stderr)
except subprocess.CalledProcessError as exc:
    output=(exc.stdout or '')+(exc.stderr or '')
    (out/'results.txt').write_text(output)
    print(output)
    raise
finally:
    docker('rm','-f',name)
