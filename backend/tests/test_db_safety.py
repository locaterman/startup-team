"""Unit checks must never connect to a database to validate the DSN guard."""
import pytest
from db_safety import require_disposable_test_database


@pytest.mark.parametrize("url", [
    "postgresql+psycopg://startup:secret@db/startup_test_ci",
    "postgresql://startup:secret@127.0.0.1/startup_test_a1b2c3d4e5f6",
])
def test_disposable_test_names_are_explicit(url):
    assert require_disposable_test_database(url) == url


@pytest.mark.parametrize("url", [
    "postgresql://startup:secret@db/production_startup_test",
    "postgresql://startup:secret@db/startup_test_ci_backup",
    "postgresql://startup:secret@db/startup_test_123",
    "postgresql://startup:secret@db/startup_test",
    "postgresql://startup:secret@db/startup",
    "sqlite:///startup_test_ci",
    "not-a-database-url",
])
def test_non_disposable_test_names_are_rejected(url):
    with pytest.raises(ValueError, match="TEST_DATABASE_URL"):
        require_disposable_test_database(url)
