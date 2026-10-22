"""Concurrent offer/capacity regressions. Runs only on ephemeral startup_test_ DB.

The startup row lock must serialize distinct managers competing for the
final capacity slot, not merely handle sequential clients correctly.
"""
import os
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from test_integration_postgres import clients, post
from test_remediation_postgres import future, get, setup, sql

pytestmark = pytest.mark.skipif(
    not os.environ.get("TEST_DATABASE_URL"),
    reason="Requires disposable PostgreSQL startup_test_ database",
)


def test_two_parallel_offers_cannot_reserve_the_same_final_slot(clients):
    owner, first_candidate, second_candidate, startup_id, vacancy_id, first_id = setup(clients)
    response = post(
        second_candidate, "/applications",
        {"target_type": "vacancy", "target_id": vacancy_id, "message": "Second candidate"},
    )
    assert response.status_code == 201, response.text
    second_id = response.json()["id"]

    barrier = threading.Barrier(2)
    def create(application_id):
        barrier.wait(timeout=10)
        return post(
            owner, f"/applications/{application_id}/offers",
            {"expires_at": future(), "message": "Parallel invitation"},
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        first_future = pool.submit(create, first_id)
        second_future = pool.submit(create, second_id)
        results = [first_future.result(timeout=30), second_future.result(timeout=30)]

    assert sorted(r.status_code for r in results) == [201, 409], [
        (r.status_code, r.text) for r in results
    ]
    loser = next(r for r in results if r.status_code == 409)
    assert loser.json()["error"]["code"] == "NO_CAPACITY"
    winner = next(r for r in results if r.status_code == 201)
    offer_id = winner.json()["id"]

    capacity = get(owner, f"/vacancies/{vacancy_id}/capacity")
    assert capacity.status_code == 200
    assert capacity.json() == {
        "positions_count": 1, "occupied": 0, "reserved": 1, "available": 0,
    }
    assert len(sql(
        "SELECT id FROM offers WHERE startup_id=:s AND vacancy_id=:v",
        s=startup_id, v=vacancy_id,
    )) == 1
    assert len(sql(
        "SELECT id FROM events WHERE startup_id=:s AND event_type='offer.sent'",
        s=startup_id,
    )) == 1
    assert not sql(
        "SELECT id FROM startup_members WHERE startup_id=:s",
        s=startup_id,
    )

    # The reserved spot, not a second spot, becomes occupied on acceptance.
    accepted_by = first_candidate if results[0].status_code == 201 else second_candidate
    accepted = post(accepted_by, f"/offers/{offer_id}/accept")
    assert accepted.status_code == 200, accepted.text
    capacity = get(owner, f"/vacancies/{vacancy_id}/capacity").json()
    assert capacity == {
        "positions_count": 1, "occupied": 1, "reserved": 0, "available": 0,
    }
    members = get(owner, f"/startups/{startup_id}/members").json()["items"]
    assert len([m for m in members if m["left_at"] is None]) == 1


def test_parallel_accept_of_single_offer_cannot_add_duplicate_members(clients):
    owner, candidate, _, startup_id, vacancy_id, application_id = setup(clients)
    offer = post(
        owner, f"/applications/{application_id}/offers", {"expires_at": future()},
    )
    assert offer.status_code == 201, offer.text
    offer_id = offer.json()["id"]

    barrier = threading.Barrier(2)
    def accept():
        barrier.wait(timeout=10)
        return post(candidate, f"/offers/{offer_id}/accept")

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = [f.result(timeout=30) for f in [
            pool.submit(accept), pool.submit(accept),
        ]]

    assert sorted(r.status_code for r in responses) == [200, 409], [
        (r.status_code, r.text) for r in responses
    ]
    assert next(r for r in responses if r.status_code == 409).json()["error"]["code"] == "INVALID_STATE_TRANSITION"
    assert len(sql(
        "SELECT id FROM startup_members WHERE startup_id=:s",
        s=startup_id,
    )) == 1
    assert len(sql(
        "SELECT id FROM events WHERE startup_id=:s AND event_type='offer.accept'",
        s=startup_id,
    )) == 1
    assert get(owner, f"/vacancies/{vacancy_id}/capacity").json()["available"] == 0
