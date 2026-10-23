"""Liveness and database readiness are deliberately different health contracts."""
from fastapi.testclient import TestClient
from app import main


class ProbeEngine:
    def __init__(self, value=1):
        self.value = value
        self.closed = False

    def connect(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *unused):
        self.closed = True

    def execute(self, query):
        assert str(query) == "SELECT 1"
        return self

    def scalar_one(self):
        return self.value


class UnavailableEngine:
    def connect(self):
        raise RuntimeError("synthetic connection failure")


def test_readiness_checks_database_round_trip(monkeypatch):
    probe = ProbeEngine()
    monkeypatch.setattr(main, "engine", probe)
    response = TestClient(main.app).get("/readyz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert probe.closed


def test_readiness_fails_closed_on_database_exception(monkeypatch):
    monkeypatch.setattr(main, "engine", UnavailableEngine())
    response = TestClient(main.app).get("/readyz")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable"}
    assert "synthetic connection failure" not in response.text


def test_readiness_rejects_unexpected_database_response(monkeypatch):
    probe = ProbeEngine(value=0)
    monkeypatch.setattr(main, "engine", probe)
    response = TestClient(main.app).get("/readyz")
    assert response.status_code == 503
    assert probe.closed


def test_liveness_remains_available_without_database(monkeypatch):
    monkeypatch.setattr(main, "engine", UnavailableEngine())
    response = TestClient(main.app).get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
