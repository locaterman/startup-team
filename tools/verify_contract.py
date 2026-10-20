"""Zero-network structural checker for target contract and implementation routes."""
from pathlib import Path
import json, yaml, re, os, sys
from collections import Counter
ROOT=Path(__file__).resolve().parents[1]
spec=yaml.safe_load((ROOT/'contracts'/'openapi.yaml').read_text(encoding='utf8'))
assert spec['openapi'].startswith('3.1.')
assert spec['servers'][0]['url']=='/api/v1'
assert isinstance(spec['paths'],dict)
schemas=spec['components']['schemas']
refs=[]
def scan(obj):
 if isinstance(obj,dict):
  if '$ref' in obj:refs.append(obj['$ref'])
  for v in obj.values():scan(v)
 elif isinstance(obj,list):
  for v in obj:scan(v)
scan(spec)
for r in refs:
 assert r.startswith('#/components/schemas/') and r.split('/')[-1] in schemas, f'Unresolved schema: {r}'
ops=[]
for path,methods in spec['paths'].items():
 assert path.startswith('/')
 for method,op in methods.items():
  assert method in ('get','post','patch','delete')
  assert 'responses' in op
  if '{' in path:
   params=set(re.findall(r'\{([^{}]+)\}',path))
   declared={p['name'] for p in op.get('parameters',[]) if p['in']=='path'}
   assert params==declared,(path,params,declared)
  ops.append(op['operationId'])
assert len(ops)==len(set(ops)),'Duplicate operationIds'
assert len(ops)>=50
# Check written SQL contains core constraints and target areas.
sql=(ROOT/'db'/'001_initial.sql').read_text()
for name in ('users','sessions','startups','vacancies','vacancy_versions','applications','application_attempts','offers','startup_members','recruiter_invitations','recruiter_grants','test_assignment_versions','test_submissions','events','notifications'):
 assert f'CREATE TABLE {name}' in sql,name
for constraint in ('uq_vacancy_application','uq_general_application','uq_pending_offer','uq_active_member','uq_current_attempt'):
 assert constraint in sql,constraint
print(f'PASS: target OpenAPI structural check: {len(ops)} operations, {len(schemas)} schemas, {len(refs)} resolved references; SQL tables present')
if '--compare' in sys.argv:
 os.environ['DATABASE_URL']='sqlite+pysqlite:///:memory:'
 sys.path.insert(0,str(ROOT/'backend'))
 from app.main import app
 actual=set()
 for route in app.routes:
  if getattr(route,'path','').startswith('/api/v1'):
   for meth in (route.methods or []):
    if meth.lower() in ('get','post','patch','delete'):actual.add((route.path.replace('/api/v1',''),meth.lower()))
 declared={(path,meth) for path,methods in spec['paths'].items() for meth in methods}
 missing=sorted(declared-actual)
 extra=sorted(actual-declared)
 print(f'Implementation: {len(actual)} methods; target: {len(declared)}; missing: {len(missing)}; extra: {len(extra)}')
 if missing: print('Missing:',missing)
 if extra:print('Extra:',extra)
