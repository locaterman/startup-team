"""Static tests run without Docker/PostgreSQL."""
from pathlib import Path
import os,sys,re,yaml
os.environ.setdefault('DATABASE_URL','sqlite+pysqlite:///:memory:')
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'backend'))
from app.main import app
from app.security import hash_password,verify_password,csrf
from fastapi.testclient import TestClient

def test_password_hashing():
    h=hash_password('super-secret')
    assert h!='super-secret'
    assert verify_password('super-secret',h)
    assert not verify_password('wrong-password',h)

def test_health_endpoint():
    with TestClient(app) as client:
        r=client.get('/healthz')
        assert r.status_code==200 and r.json()['status']=='ok'

def test_openapi_target_matches_implementation_routes():
    target=yaml.safe_load((ROOT/'contracts'/'openapi.yaml').read_text(encoding='utf-8'))
    declared={(path,method) for path,ops in target['paths'].items() for method in ops}
    implemented={(route.path.removeprefix('/api/v1'),method.lower())
                 for route in app.routes if route.path.startswith('/api/v1')
                 for method in (route.methods or []) if method.lower() in ['get','post','patch','delete']}
    assert implemented==declared, {'missing':declared-implemented,'extra':implemented-declared}

def test_all_path_refs_resolve():
    target=yaml.safe_load((ROOT/'contracts'/'openapi.yaml').read_text(encoding='utf-8'))
    schema_names=set(target['components']['schemas'])
    refs=re.findall(r'\$ref:\s*[\'"]?(#/components/schemas/\w+)',
        (ROOT/'contracts'/'openapi.yaml').read_text(encoding='utf-8'))
    assert len(refs)>100
    assert all(x.split('/')[-1] in schema_names for x in refs)
