"""Session setup: connection options and the test DB's leftover-timezone safety net."""

from __future__ import annotations

import pytest
from sqlalchemy import create_engine, text

from scraper.db import pg_options
from tests.conftest import _TEST_NAME_RE, TEST_DATABASE_URL, reset_db_timezone


@pytest.mark.parametrize(
    "url,expected",
    [
        ("postgresql://u:p@h:5432/db", "-c timezone=UTC"),
        ("postgresql://u:p@h:5432/db?sslmode=require", "-c timezone=UTC"),
        # An existing options value is extended, not replaced; ours comes last so it wins.
        (
            "postgresql://u:p@h:5432/db?options=-c%20application_name%3Dscraper",
            "-c application_name=scraper -c timezone=UTC",
        ),
        (
            "postgresql+psycopg://u:p@h/db?options=-c%20timezone%3DAsia/Tokyo",
            "-c timezone=Asia/Tokyo -c timezone=UTC",
        ),
    ],
)
def test_pg_options_appends_to_existing_options(url: str, expected: str) -> None:
    assert pg_options(url) == expected


def test_reset_db_timezone_clears_a_leftover_setting(db) -> None:
    """A killed run can leave `ALTER DATABASE ... SET timezone` behind; the
    session-scoped fixture clears it with this helper."""
    with db.connect() as c:
        name = c.execute(text("SELECT current_database()")).scalar_one()
    assert _TEST_NAME_RE.search(name)  # only ever alter a throwaway test database
    probe = text(
        "SELECT COUNT(*) FROM pg_db_role_setting s JOIN pg_database d ON d.oid = s.setdatabase "
        "WHERE d.datname = :n AND s.setrole = 0 AND EXISTS "
        "(SELECT 1 FROM unnest(s.setconfig) AS c WHERE c ILIKE 'timezone=%')"
    )
    with db.begin() as c:
        c.execute(text(f'ALTER DATABASE "{name}" SET timezone = \'Asia/Tokyo\''))
    try:
        with db.connect() as c:
            assert c.execute(probe, {"n": name}).scalar_one() == 1
        reset_db_timezone(TEST_DATABASE_URL)
        reset_db_timezone(TEST_DATABASE_URL)  # idempotent
        with db.connect() as c:
            assert c.execute(probe, {"n": name}).scalar_one() == 0
    finally:
        with create_engine(
            TEST_DATABASE_URL.replace("postgresql://", "postgresql+psycopg://", 1),
            isolation_level="AUTOCOMMIT",
        ).connect() as c:
            c.execute(text(f'ALTER DATABASE "{name}" RESET timezone'))
