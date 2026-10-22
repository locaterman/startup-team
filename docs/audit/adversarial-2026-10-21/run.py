import subprocess,pathlib,time,uuid
root=pathlib.Path(__file__).resolve().parents[3]
out=pathlib.Path(__file__).resolve().parent
name='startup-adversarial-'+uuid.uuid4().hex[:10]
def call(*args,**kw): return subprocess.run(['docker',*args],check=True,**kw)
call('run','-d','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_USER=startup','-e','POSTGRES_PASSWORD=audit-only','-e','POSTGRES_DB=startup_test_independent','postgres:16-alpine')
try:
 for _ in range(60):
  if subprocess.run(['docker','exec',name,'pg_isready','-h','127.0.0.1','-U','startup'],capture_output=True).returncode==0:break
  time.sleep(.5)
 url='postgresql+psycopg://startup:audit-only@127.0.0.1:5432/startup_test_independent'
 cmd='alembic -c backend/alembic.ini upgrade head && python -m pytest -q -p no:cacheprovider backend/tests && python -m pytest -q -p no:cacheprovider docs/audit/independent/test_adversarial.py -k "controlled_concurrency or authorization_matrix or independent_deadlines" && python -m pytest -q -s -p no:cacheprovider /audit/test_new.py'
 r=subprocess.run(['docker','run','--rm','--network','container:'+name,'--mount',f'type=bind,source={root},target=/app,readonly','--mount',f'type=bind,source={out},target=/audit,readonly','--workdir','/app','-e','PYTHONPATH=/app/backend:/app/backend/tests','-e','PYTHONDONTWRITEBYTECODE=1','-e','DATABASE_URL='+url,'-e','TEST_DATABASE_URL='+url,'--entrypoint','sh','startup-adversarial-api:20261021','-c',cmd],capture_output=True,text=True)
 (out/'results-fresh-image.txt').write_text(r.stdout+r.stderr)
 print(r.stdout+r.stderr)
 print('exit',r.returncode)
 r.check_returncode()
finally:call('rm','-f',name)
