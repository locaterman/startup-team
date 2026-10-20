"""Read schema only; restore the original database container to its stopped state."""
import json,pathlib,subprocess,time
root=pathlib.Path(__file__).resolve().parents[3]
base=['docker','compose','-p','startup_team_demo_macos']
def run(args,**kw):return subprocess.run(args,check=True,**kw)
state=json.loads(run(['docker','inspect','startup_team_demo_macos-db-1'],capture_output=True,text=True).stdout)[0]['State']
if state.get('Running'):raise RuntimeError('Expected the original stopped DB; refusing to change a different state')
run(base+['start','db'])
try:
 for _ in range(30):
  ready=subprocess.run(base+['exec','-T','db','pg_isready','-U','startup','-d','startup'],capture_output=True)
  if ready.returncode==0:break
  time.sleep(1)
 else:raise RuntimeError('Database did not become ready')
 schema=run(base+['exec','-T','db','pg_dump','--schema-only','--no-owner','--no-privileges','-U','startup','-d','startup'],capture_output=True,text=True).stdout
 (root/'docs/audit/completion/existing_schema.sql').write_text(schema)
 revision=run(base+['exec','-T','db','psql','-U','startup','-d','startup','-At','-c','BEGIN READ ONLY; SELECT version_num FROM alembic_version; COMMIT;'],capture_output=True,text=True).stdout
 (root/'docs/audit/completion/existing_revision.txt').write_text(revision)
 print('Schema-only dump saved; revision:',revision.strip())
finally:run(base+['stop','db'])
