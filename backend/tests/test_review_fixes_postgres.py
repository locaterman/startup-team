"""Regressions for the October 21 review, using only disposable PostgreSQL."""
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.main import app
from test_integration_postgres import clients, post
from test_telegram_auth import signed, TOKEN

pytestmark = pytest.mark.skipif(not os.environ.get('TEST_DATABASE_URL'), reason='Disposable PostgreSQL required')


def future():
    return (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()


def sql(query, **params):
    engine = create_engine(os.environ['TEST_DATABASE_URL'])
    try:
        with engine.begin() as conn:
            result = conn.execute(text(query), params)
            return result.mappings().all() if result.returns_rows else []
    finally:
        engine.dispose()


def setup(clients):
    owner, candidate = clients['ivan'], clients['maria']
    project = post(owner, '/startups', {'title': 'Review regression'}).json()['id']
    vacancy = post(owner, f'/startups/{project}/vacancies', {
        'title': 'Developer', 'positions_count': 1, 'application_deadline': future(),
    }).json()['id']
    application = post(candidate, '/applications', {'target_type': 'vacancy', 'target_id': vacancy}).json()['id']
    task = create_task(owner, vacancy, 'initial').json()['id']
    submission = post(candidate, f'/applications/{application}/test-submissions', {
        'test_version_id': task, 'solution_url': 'https://example.test/original',
    }).json()['id']
    return owner, candidate, project, vacancy, application, submission


def create_task(owner, vacancy, kind):
    return post(owner, f'/vacancies/{vacancy}/tests/versions', {
        'description': kind, 'submission_deadline': future(), 'change_type': kind,
    })


@pytest.mark.parametrize('reviewed', [False, True])
@pytest.mark.parametrize('kind', ['ordinary', 'critical'])
def test_restore_reconciles_test_currency_without_erasing_review(clients, reviewed, kind):
    owner, candidate, _, vacancy, application, submission = setup(clients)
    if reviewed:
        assert owner[0].patch('/api/v1/test-submissions/' + submission,
                              json={'status': 'reviewed'}, headers=owner[1]).status_code == 200
    before = sql('SELECT reviewed_by,reviewed_at FROM test_submissions WHERE id=:id', id=submission)[0]
    assert post(candidate, f'/applications/{application}/withdraw').status_code == 200
    assert create_task(owner, vacancy, kind).status_code == 201
    assert post(candidate, f'/applications/{application}/restore').status_code == 200
    rows = candidate[0].get(f'/api/v1/applications/{application}/test-submissions').json()['items']
    assert rows[0]['status'] == ('superseded' if kind == 'critical' else 'reviewed' if reviewed else 'submitted')
    after = sql('SELECT reviewed_by,reviewed_at FROM test_submissions WHERE id=:id', id=submission)[0]
    assert after == before
    assert post(candidate, f'/applications/{application}/withdraw').status_code == 200
    assert post(candidate, f'/applications/{application}/restore').status_code == 200
    assert candidate[0].get(f'/api/v1/applications/{application}/test-submissions').json()['items'] == rows


def wait_for_lock_waiters(count):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if len(sql("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")) >= count:
            return
        time.sleep(.02)
    pytest.fail('Requests did not reach the startup lock')


def ordered_race(project, first, second, before_release=None):
    engine = create_engine(os.environ['TEST_DATABASE_URL'])
    try:
        with ThreadPoolExecutor(2) as pool:
            with engine.begin() as gate:
                gate.execute(text('SELECT id FROM startups WHERE id=:id FOR UPDATE'), {'id': project})
                try:
                    a = pool.submit(first)
                    wait_for_lock_waiters(1)
                    b = pool.submit(second)
                    wait_for_lock_waiters(2)
                    if before_release:
                        before_release(gate)
                finally:
                    # Release even when synchronization fails; workers cannot hang on the gate.
                    gate.commit()
            return a.result(10), b.result(10)
    finally:
        engine.dispose()


@pytest.mark.parametrize('restore_first', [False, True])
def test_critical_restore_serializes_in_both_orders(clients, restore_first):
    owner, candidate, project, vacancy, application, submission = setup(clients)
    assert post(candidate, f'/applications/{application}/withdraw').status_code == 200
    critical = lambda: create_task(owner, vacancy, 'critical')
    restore = lambda: post(candidate, f'/applications/{application}/restore')
    responses = ordered_race(project, restore if restore_first else critical, critical if restore_first else restore)
    assert sorted(r.status_code for r in responses) == [200, 201]
    assert sql('SELECT status FROM test_submissions WHERE id=:id', id=submission)[0]['status'] == 'superseded'


def test_critical_preserves_completed_hire(clients):
    owner, candidate, _, vacancy, application, submission = setup(clients)
    assert owner[0].patch('/api/v1/test-submissions/' + submission,
                          json={'status': 'reviewed'}, headers=owner[1]).status_code == 200
    offer = post(owner, f'/applications/{application}/offers', {'expires_at': future()}).json()['id']
    assert post(candidate, f'/offers/{offer}/accept').status_code == 200
    before = sql('SELECT * FROM test_submissions WHERE id=:id', id=submission)[0]
    assert create_task(owner, vacancy, 'critical').status_code == 201
    assert sql('SELECT * FROM test_submissions WHERE id=:id', id=submission)[0] == before


@pytest.mark.parametrize('value', [0, -1, 2147483648, 10**50, 1.5, '2', True])
@pytest.mark.parametrize('operation', ['create', 'settings'])
def test_capacity_rejects_invalid_values_without_changes(clients, value, operation):
    owner, _, project, vacancy, _, _ = setup(clients)
    before = sql('SELECT id,positions_count,revision FROM vacancies WHERE startup_id=:id ORDER BY id', id=project)
    with TestClient(app, raise_server_exceptions=False) as client:
        client.cookies.update(owner[0].cookies)
        if operation == 'create':
            response = client.post(f'/api/v1/startups/{project}/vacancies', headers=owner[1], json={
                'title': 'Invalid', 'positions_count': value, 'application_deadline': future(),
            })
        else:
            response = client.patch(f'/api/v1/vacancies/{vacancy}/settings', headers=owner[1],
                                    json={'positions_count': value})
    assert response.status_code == 422, response.text
    assert response.json()['error']['code'] == 'VALIDATION_ERROR'
    assert sql('SELECT id,positions_count,revision FROM vacancies WHERE startup_id=:id ORDER BY id', id=project) == before


def test_capacity_accepts_storage_boundaries(clients):
    owner = clients['ivan']
    project = post(owner, '/startups', {'title': 'Boundaries'}).json()['id']
    vacancy = post(owner, f'/startups/{project}/vacancies', {
        'title': 'Maximum', 'positions_count': 2147483647, 'application_deadline': future(),
    })
    assert vacancy.status_code == 201, vacancy.text
    path = '/api/v1/vacancies/' + vacancy.json()['id'] + '/settings'
    for value in [1, 2147483647]:
        response = owner[0].patch(path, headers=owner[1], json={'positions_count': value})
        assert response.status_code == 200 and response.json()['positions_count'] == value


def test_onboarding_blocks_domain_changes_but_allows_profile_and_logout(clients, monkeypatch):
    monkeypatch.setenv('TELEGRAM_BOT_TOKEN', TOKEN)
    project = post(clients['ivan'], '/startups', {'title': 'Existing project'}).json()['id']
    with TestClient(app) as client:
        assert client.post('/api/v1/auth/telegram', json={'init_data': signed(stamp=int(time.time()))}).status_code == 200
        user = client.get('/api/v1/auth/me').json()['id']
        headers = {'X-CSRF-Token': client.get('/api/v1/auth/csrf').json()['csrf_token']}
        assert client.get('/api/v1/auth/context').json()['onboarding_required']
        commands = [
            ('POST', '/startups', {'title': 'Blocked'}),
            ('POST', '/applications', {'target_type': 'startup', 'target_id': project}),
            ('PATCH', '/startups/' + project, {'title': 'Blocked edit'}),
            ('DELETE', '/startups/' + project, None),
        ]
        for method, path, body in commands:
            response = client.request(method, '/api/v1' + path, headers=headers, json=body)
            assert response.status_code == 403, response.text
            assert response.json()['error']['code'] == 'ONBOARDING_REQUIRED'
        assert not sql('SELECT id FROM startups WHERE owner_id=:id', id=user)
        assert not sql('SELECT id FROM applications WHERE applicant_id=:id', id=user)
        # An incidental profile edit does not complete onboarding.
        assert client.patch('/api/v1/users/me', json={'bio': 'Hello'}, headers=headers).status_code == 200
        assert client.get('/api/v1/auth/context').json()['onboarding_required']
        assert client.patch('/api/v1/users/me', json={'name': 'Participant'}, headers=headers).status_code == 200
        assert not client.get('/api/v1/auth/context').json()['onboarding_required']
        assert client.post('/api/v1/startups', json={'title': 'Allowed'}, headers=headers).status_code == 201
        assert client.post('/api/v1/auth/logout', headers=headers).status_code == 204
        assert client.get('/api/v1/auth/me').status_code == 401


def test_expired_recruiter_is_visible_to_recipient_without_owner_read(clients):
    owner, recipient = clients['ivan'], clients['alex']
    project = post(owner, '/startups', {'title': 'Recruiter expiry'}).json()['id']
    user = recipient[0].get('/api/v1/auth/me').json()['id']
    invitation = post(owner, f'/startups/{project}/recruiter-invitations', {
        'user_id': user, 'expires_at': future(),
    }).json()['id']
    sql("UPDATE recruiter_invitations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=:id", id=invitation)
    for _ in range(2):
        rows = recipient[0].get('/api/v1/recruiter-invitations/mine').json()['items']
        assert next(x for x in rows if x['id'] == invitation)['status'] == 'expired'
        response = post(recipient, f'/recruiter-invitations/{invitation}/accept')
        assert response.status_code == 409 and response.json()['error']['code'] == 'INVITATION_NOT_ACTIVE'
    assert not sql('SELECT id FROM recruiter_grants WHERE startup_id=:id', id=project)
    new = post(owner, f'/startups/{project}/recruiter-invitations', {'user_id': user, 'expires_at': future()})
    assert new.status_code == 201
    assert post(recipient, '/recruiter-invitations/' + new.json()['id'] + '/accept').status_code == 200
    rows = recipient[0].get('/api/v1/recruiter-invitations/mine').json()['items']
    assert {x['id']: x['status'] for x in rows} == {invitation: 'expired', new.json()['id']: 'accepted'}


@pytest.mark.parametrize('accept_first', [False, True])
def test_expired_recruiter_accept_reinvite_race(clients, accept_first):
    owner, recipient = clients['ivan'], clients['alex']
    project = post(owner, '/startups', {'title': 'Recruiter race'}).json()['id']
    user = recipient[0].get('/api/v1/auth/me').json()['id']
    body = {'user_id': user, 'expires_at': future()}
    invitation = post(owner, f'/startups/{project}/recruiter-invitations', body).json()['id']
    accept = lambda: post(recipient, f'/recruiter-invitations/{invitation}/accept')
    reinvite = lambda: post(owner, f'/startups/{project}/recruiter-invitations', body)
    responses = ordered_race(project, accept if accept_first else reinvite, reinvite if accept_first else accept,
        lambda gate: gate.execute(text("UPDATE recruiter_invitations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=:id"), {'id': invitation}))
    assert sorted(r.status_code for r in responses) == [201, 409]
    rows = recipient[0].get('/api/v1/recruiter-invitations/mine').json()['items']
    assert sorted(x['status'] for x in rows) == ['expired', 'pending']
    assert not sql('SELECT id FROM recruiter_grants WHERE startup_id=:id', id=project)


def test_expiry_is_not_rewritten_as_revoked_by_later_owner_action(clients):
    owner, recipient = clients['ivan'], clients['alex']
    project = post(owner, '/startups', {'title': 'Stable expiry'}).json()['id']
    user = recipient[0].get('/api/v1/auth/me').json()['id']
    invitation = post(owner, f'/startups/{project}/recruiter-invitations', {
        'user_id': user, 'expires_at': future(),
    }).json()['id']
    sql("UPDATE recruiter_invitations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=:id", id=invitation)
    assert post(owner, f'/recruiter-invitations/{invitation}/revoke').status_code == 409
    assert post(owner, f'/startups/{project}/archive').status_code == 200
    for path, pair in [('/recruiter-invitations/mine', recipient), (f'/startups/{project}/recruiter-invitations', owner)]:
        rows = pair[0].get('/api/v1' + path).json()['items']
        assert next(x for x in rows if x['id'] == invitation)['status'] == 'expired'
