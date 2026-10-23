"""Explicit guard for destructive PostgreSQL test fixtures.

Never infer a disposable test database from a substring of a DSN. The accepted
names are the fixed CI database and random local test databases created by
the repository's verification scripts.
"""
import re
from sqlalchemy.engine import make_url

_DISPOSABLE_DATABASE = re.compile(r"(?:startup_test_ci|startup_test_[a-f0-9]{12})\Z")


def require_disposable_test_database(raw_url: str) -> str:
    try:
        url = make_url(raw_url)
    except Exception as exc:
        raise ValueError("Invalid TEST_DATABASE_URL") from exc
    if (not url.drivername.startswith("postgresql") or
            not url.database or not _DISPOSABLE_DATABASE.fullmatch(url.database)):
        raise ValueError(
            "Refusing destructive tests: TEST_DATABASE_URL must name startup_test_ci "
            "or startup_test_<12 lowercase hex characters>"
        )
    return raw_url
