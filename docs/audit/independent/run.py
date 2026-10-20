"""Disposable audit runner; no Compose operations, host ports or persistent data."""
import pathlib, subprocess, uuid, time
root=pathlib.Path(__file__).resolve().parents[3]
name='startup-independent-'+uuid.uuid4().hex[:12]
def call(*args, **kw):return subprocess.run(['docker',*args],check=True,**kw)
call('run','-d','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data',
     '-e','POSTGRES_USER=startup','-e','POSTGRES_PASSWORD=audit-only',
     '-e','POSTGRES_DB=startup_test_independent','postgres:16-alpine')
try:
    for _ in range(30):
        r=subprocess.run(['docker','exec',name,'pg_isready','-U','startup','-d','startup_test_independent'],capture_output=True)
        if r.returncode==0:break
        time.sleep(.5)
    else:raise RuntimeError('PostgreSQL not ready')
    url='postgresql+psycopg://startup:audit-only@127.0.0.1:5432/startup_test_independent'
    command=('alembic -c backend/alembic.ini upgrade head && '
             'python -m pytest -q -s -p no:cacheprovider backend/tests '
             'docs/audit/independent/test_adversarial.py')
    result=call('run','--rm','--network','container:'+name,
        '--mount',f'type=bind,source={root},target=/app,readonly','--workdir','/app',
        '-e','PYTHONPATH=/app/backend','-e','PYTHONDONTWRITEBYTECODE=1',
        '-e','DATABASE_URL='+url,'-e','TEST_DATABASE_URL='+url,
        '--entrypoint','sh','startup-independent-audit-api','-c',command,
        capture_output=True,text=True)
    print(result.stdout);print(result.stderr)
    (root/'docs/audit/independent/results.txt').write_text(result.stdout+result.stderr)
except subprocess.CalledProcessError as e:
    output=(e.stdout or '')+(e.stderr or '')
    print(output)
    (root/'docs/audit/independent/results.txt').write_text(output)
    raise
finally:call('rm','-f',name)
