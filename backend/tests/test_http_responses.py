"""HTTP 204 must contain no body: Uvicorn rejects JSON 'null' on bodyless responses."""
from types import SimpleNamespace

from app import main


def test_logout_emits_bodyless_204_and_clears_cookie(monkeypatch):
    statements = []
    monkeypatch.setattr(main, "run", lambda _conn, sql, **kwargs: statements.append((sql, kwargs)))
    fake_request = SimpleNamespace(cookies={"session": "ephemeral-test-session"})
    response = main.logout(fake_request, conn=object(), me={"id": "test-user"})

    assert response.status_code == 204
    assert response.body == b""
    assert "content-length" not in response.headers
    assert "session=" in response.headers.get("set-cookie", "")
    assert "Max-Age=0" in response.headers.get("set-cookie", "")
    assert len(statements) == 1
    assert "revoked_at" in statements[0][0]
