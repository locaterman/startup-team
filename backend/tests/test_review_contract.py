"""Static regression checks for the independent engineering-review changes.
These do not prove PostgreSQL functions/migrations actually execute.
"""
from pathlib import Path
import yaml
ROOT=Path(__file__).resolve().parents[2]

def test_submission_explicitly_binds_test_version():
    spec=yaml.safe_load((ROOT/'contracts/openapi.yaml').read_text(encoding='utf-8'))
    model=spec['components']['schemas']['TestSubmissionCreate']
    assert 'test_version_id' in model['required']
    assert 'solution_url' in model['required']
    assert model['properties']['test_version_id']['format']=='uuid'

def test_review_exposes_recruiter_revoke_and_read_access_rules():
    spec=yaml.safe_load((ROOT/'contracts/openapi.yaml').read_text(encoding='utf-8'))
    assert 'post' in spec['paths']['/recruiter-invitations/{invitation_id}/revoke']
    for path in ['/applications/{application_id}',
                 '/startups/{startup_id}/applications',
                 '/startups/{startup_id}/events']:
        assert 'recruiter' in spec['paths'][path]['get']['description']
    for name, schema in spec['components']['schemas'].items():
        if name.startswith('List'):
            assert 'next_cursor' in schema['required'], name

def test_relationship_validation_exists_at_sql_level():
    sql=(ROOT/'db/001_initial.sql').read_text(encoding='utf-8')
    for name in ['tg_attempt_binding','tg_offer_binding','tg_member_binding',
                 'tg_recruiter_binding','tg_test_submission_binding']:
        assert f'CREATE TRIGGER {name}' in sql


def test_domain_writes_require_completed_onboarding():
    from app.main import app
    from app.security import domain_auth
    exemptions={'/api/v1/auth/login','/api/v1/auth/telegram','/api/v1/auth/logout','/api/v1/users/me'}
    for route in app.routes:
        if not getattr(route,'path','').startswith('/api/v1') or route.path in exemptions:
            continue
        if route.methods & {'POST','PATCH','PUT','DELETE'}:
            assert any(dep.call is domain_auth for dep in route.dependant.dependencies),route.path


def test_capacity_contract_matches_storage_bounds():
    spec=yaml.safe_load((ROOT/'contracts/openapi.yaml').read_text(encoding='utf-8'))
    for name in ('VacancyCreate','VacancySettings'):
        field=spec['components']['schemas'][name]['properties']['positions_count']
        assert field['type']=='integer' and field['minimum']==1 and field['maximum']==2147483647
