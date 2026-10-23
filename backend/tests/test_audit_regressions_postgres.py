"""Targeted regression tests for independent October 23 backend / DB audit.

All mutating integration cases use the existing disposable PostgreSQL fixture.
Nothing here targets the live Telegram database.
"""
import os
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from db_safety import require_disposable_test_database
from test_integration_postgres import clients, post
from test_review_fixes_postgres import create_task, future, sql

pytestmark = pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL"), reason="Disposable PostgreSQL required",
)


def candidate_flow(clients):
    owner, candidate = clients["ivan"], clients["maria"]
    project = post(owner, "/startups", {"title": "Audit transition"}).json()["id"]
    vacancy = post(owner, f"/startups/{project}/vacancies", {
        "title": "Developer", "positions_count": 1, "application_deadline": future(),
    }).json()["id"]
    application = post(candidate, "/applications", {
        "target_type": "vacancy", "target_id": vacancy,
    }).json()["id"]
    return owner, candidate, project, vacancy, application


def change_vacancy(owner, vacancy, mode):
    response = post(owner, f"/vacancies/{vacancy}/versions", {
        "title": "Developer v2", "change_mode": mode,
    })
    assert response.status_code == 201, response.text


@pytest.mark.parametrize("end_action", ["revoke", "expire"])
def test_later_vacancy_reset_does_not_resurrect_old_attempt(clients, end_action):
    owner, candidate, project, vacancy, application = candidate_flow(clients)
    initial = candidate[0].get(f"/api/v1/applications/{application}").json()
    offer = post(owner, f"/applications/{application}/offers", {
        "expires_at": future(),
    }).json()["id"]
    change_vacancy(owner, vacancy, "reset_applications")
    before = candidate[0].get(f"/api/v1/applications/{application}").json()
    assert before["status"] == "offer_pending"

    if end_action == "revoke":
        result = post(owner, f"/offers/{offer}/revoke")
        assert result.status_code == 200, result.text
    else:
        sql("UPDATE offers SET expires_at=clock_timestamp()-interval '1 second' WHERE id=:id", id=offer)
        result = candidate[0].get("/api/v1/offers/mine")
        assert result.status_code == 200, result.text

    after = candidate[0].get(f"/api/v1/applications/{application}").json()
    assert after["status"] == "reset"
    assert after["attempt_id"] == initial["attempt_id"]
    forbidden = post(owner, f"/applications/{application}/offers", {"expires_at": future()})
    assert forbidden.status_code == 409
    assert post(candidate, f"/applications/{application}/attempts", {"message": "v2 terms"}).status_code == 201
    new_attempt = candidate[0].get(f"/api/v1/applications/{application}").json()
    assert new_attempt["status"] == "pending"
    assert new_attempt["attempt_id"] != initial["attempt_id"]
    assert post(owner, f"/applications/{application}/offers", {"expires_at": future()}).status_code == 201


def test_revoke_without_reset_restores_reviewing(clients):
    owner, candidate, project, vacancy, application = candidate_flow(clients)
    offer = post(owner, f"/applications/{application}/offers", {"expires_at": future()}).json()["id"]
    change_vacancy(owner, vacancy, "keep_applications")
    assert post(owner, f"/offers/{offer}/revoke").status_code == 200
    assert candidate[0].get(f"/api/v1/applications/{application}").json()["status"] == "reviewing"
    assert post(owner, f"/applications/{application}/offers", {"expires_at": future()}).status_code == 201


def test_withdrawn_critical_submission_cannot_be_reviewed(clients):
    owner, candidate, project, vacancy, application = candidate_flow(clients)
    test = create_task(owner, vacancy, "initial").json()["id"]
    sub = post(candidate, f"/applications/{application}/test-submissions", {
        "test_version_id": test, "solution_url": "https://example.org/submission",
    }).json()["id"]
    assert post(candidate, f"/applications/{application}/withdraw").status_code == 200
    assert create_task(owner, vacancy, "critical").status_code == 201
    response = owner[0].patch(f"/api/v1/test-submissions/{sub}", headers=owner[1], json={"status": "reviewed"})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "SUBMISSION_NOT_REVIEWABLE"
    assert not sql("SELECT id FROM events WHERE entity_id=:id AND event_type='test.reviewed'", id=sub)
    assert post(candidate, f"/applications/{application}/restore").status_code == 200
    assert sql("SELECT status FROM test_submissions WHERE id=:id", id=sub)[0]["status"] == "superseded"


def test_archived_startup_submission_cannot_be_reviewed(clients):
    owner, candidate, project, vacancy, application = candidate_flow(clients)
    test = create_task(owner, vacancy, "initial").json()["id"]
    sub = post(candidate, f"/applications/{application}/test-submissions", {
        "test_version_id": test, "solution_url": "https://example.org/submission",
    }).json()["id"]
    assert post(owner, f"/startups/{project}/archive").status_code == 200
    response = owner[0].patch(f"/api/v1/test-submissions/{sub}", headers=owner[1], json={"status": "reviewed"})
    assert response.status_code == 409
    assert sql("SELECT status FROM test_submissions WHERE id=:id", id=sub)[0]["status"] == "submitted"


def test_offer_accept_checks_database_clock_at_update(clients, monkeypatch):
    from app import main as main_module

    owner, candidate, project, vacancy, application = candidate_flow(clients)
    offer = post(owner, f"/applications/{application}/offers", {"expires_at": future()}).json()["id"]
    real_capacity_locked = main_module.capacity_locked

    def expire_between_check_and_update(conn, vacancy_id):
        # Deterministically emulate the deadline passing after precheck.
        conn.execute(text("UPDATE offers SET expires_at=clock_timestamp()-interval '1 second' WHERE id=:id"),
                     {"id": offer})
        return real_capacity_locked(conn, vacancy_id)

    with monkeypatch.context() as patch:
        patch.setattr(main_module, "capacity_locked", expire_between_check_and_update)
        response = post(candidate, f"/offers/{offer}/accept")
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "OFFER_EXPIRED"
    assert sql("SELECT status FROM offers WHERE id=:id", id=offer)[0]["status"] == "expired"
    assert not sql("SELECT id FROM startup_members WHERE startup_id=:id", id=project)


def test_recruiter_accept_rechecks_database_clock(clients, monkeypatch):
    from app import main as main_module

    owner, recipient = clients["ivan"], clients["alex"]
    project = post(owner, "/startups", {"title": "Recruiter deadline"}).json()["id"]
    person_id = recipient[0].get("/api/v1/auth/me").json()["id"]
    invitation = post(owner, f"/startups/{project}/recruiter-invitations", {
        "user_id": person_id, "expires_at": future(),
    }).json()["id"]
    real_run = main_module.run

    def expire_during_grant_check(conn, query, **kw):
        if query == "SELECT 1 FROM recruiter_grants WHERE startup_id=:s AND user_id=:u AND revoked_at IS NULL":
            conn.execute(text("UPDATE recruiter_invitations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=:id"),
                         {"id": invitation})
        return real_run(conn, query, **kw)

    with monkeypatch.context() as patch:
        patch.setattr(main_module, "run", expire_during_grant_check)
        response = post(recipient, f"/recruiter-invitations/{invitation}/accept")
    assert response.status_code == 409, response.text
    assert response.json()["error"]["code"] == "INVITATION_NOT_ACTIVE"
    assert not sql("SELECT id FROM recruiter_grants WHERE startup_id=:s", s=project)


def test_normal_offer_and_recruiter_accept_still_work(clients):
    owner, candidate, project, vacancy, application = candidate_flow(clients)
    offer = post(owner, f"/applications/{application}/offers", {"expires_at": future()}).json()["id"]
    assert post(candidate, f"/offers/{offer}/accept").status_code == 200
    person_id = clients["alex"][0].get("/api/v1/auth/me").json()["id"]
    inv = post(owner, f"/startups/{project}/recruiter-invitations", {
        "user_id": person_id, "expires_at": future(),
    }).json()["id"]
    assert post(clients["alex"], f"/recruiter-invitations/{inv}/accept").status_code == 200
