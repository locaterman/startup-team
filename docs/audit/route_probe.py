"""Diagnostic only: exercise routing without a database or real authentication.

Run with PYTHONPATH=backend. A 422 below reproduces the current defect;
this script is evidence, not a passing regression test for the desired behavior.
"""
import json
import uuid
from fastapi.testclient import TestClient
from starlette.routing import Match
from app.main import app
from app.database import db
from app.security import auth

class EmptyResult:
    def mappings(self):
        return self

    def all(self):
        return []

class EmptyConnection:
    def execute(self, *args, **kwargs):
        return EmptyResult()

def fake_db():
    yield EmptyConnection()

app.dependency_overrides[db] = fake_db
app.dependency_overrides[auth] = lambda: {'id': uuid.UUID(int=1)}
try:
    with TestClient(app) as client:
        for path in ['/api/v1/offers/mine', '/api/v1/applications/mine',
                     '/api/v1/recruiter-invitations/mine']:
            scope = {'type': 'http', 'path': path, 'method': 'GET'}
            matched = next(r.path for r in app.routes if r.matches(scope)[0] == Match.FULL)
            response = client.get(path)
            print(json.dumps({'path': path, 'first_match': matched,
                              'status': response.status_code, 'body': response.json()},
                             ensure_ascii=False))
finally:
    app.dependency_overrides.clear()
