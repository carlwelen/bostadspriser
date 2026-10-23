"""Shared pytest fixtures.

Pure parser tests need nothing from here. Tests that touch Postgres request the
`db` fixture, which points the scraper at a throwaway *test* database (never the
dev database), migrates it with Prisma (Prisma owns the schema) and truncates
every table before each test.

Database resolution mirrors web/scripts/test-db.cjs:
  1. TEST_DATABASE_URL verbatim, else
  2. DATABASE_URL (env or repo-root .env) with the name swapped for
     TEST_DB_NAME (default "bostadspriser_test").
The resolved name must contain a "test" segment or the fixture refuses to run.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import pytest
from dotenv import dotenv_values

REPO_ROOT = Path(__file__).resolve().parents[2]
WEB_DIR = REPO_ROOT / "web"
_FALLBACK_URL = "postgresql://bostadspriser:bostadspriser@localhost:5432/bostadspriser"
_TEST_NAME_RE = re.compile(r"(^|_)test(_|$)")

# Keep every test run away from the real cache/state dirs and the real Mapbox
# token. These must be set before `scraper.config` is imported, because it
# calls load_dotenv() (which never overrides existing variables).
_TMP = Path(tempfile.mkdtemp(prefix="scraper-tests-"))
os.environ["SCRAPER_CACHE_DIR"] = str(_TMP / "cache")
os.environ["SCRAPER_STORAGE_STATE"] = str(_TMP / "state" / "storageState.json")
os.environ["MAPBOX_TOKEN"] = "test-token"


def _test_database_url() -> str:
    explicit = os.environ.get("TEST_DATABASE_URL")
    if explicit:
        url = explicit
    else:
        base = (
            os.environ.get("DATABASE_URL")
            or dotenv_values(REPO_ROOT / ".env").get("DATABASE_URL")
            or _FALLBACK_URL
        )
        parts = urlsplit(base)
        name = os.environ.get("TEST_DB_NAME", "bostadspriser_test")
        url = urlunsplit(parts._replace(path=f"/{name}"))
    name = urlsplit(url).path.lstrip("/")
    if not _TEST_NAME_RE.search(name):
        raise RuntimeError(
            f'refusing to use database "{name}" for tests: the name must contain a "test" segment'
        )
    return url


# Point the scraper at the test DB up front so nothing can fall back to the dev
# DATABASE_URL from .env, even tests that forget to request `db`.
TEST_DATABASE_URL = _test_database_url()
os.environ["DATABASE_URL"] = TEST_DATABASE_URL


def pytest_sessionfinish(session, exitstatus) -> None:  # noqa: ARG001
    shutil.rmtree(_TMP, ignore_errors=True)


@pytest.fixture(scope="session")
def _migrated_db() -> str:
    """Create (if missing) and migrate the test DB once per session."""
    pnpm = shutil.which("pnpm")
    if pnpm is None:
        raise RuntimeError("pnpm is required to migrate the test database (Prisma owns the schema)")
    proc = subprocess.run(
        [pnpm, "exec", "prisma", "migrate", "deploy"],
        cwd=WEB_DIR,
        env={**os.environ, "DATABASE_URL": TEST_DATABASE_URL},
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            "prisma migrate deploy failed for the test database "
            f"(try `node web/scripts/test-db.cjs reset`):\n{proc.stdout}\n{proc.stderr}"
        )
    return TEST_DATABASE_URL


@pytest.fixture()
def db(_migrated_db: str):
    """A clean, migrated test database. Yields the SQLAlchemy engine."""
    from sqlalchemy import text

    from scraper import db as scraper_db

    # Drop any cached engine/reflection so the module binds to the test DB.
    scraper_db._engine = None
    scraper_db._metadata = None
    scraper_db._SessionLocal = None
    eng = scraper_db.engine()
    with eng.begin() as c:
        current = c.execute(text("SELECT current_database()")).scalar_one()
        if not _TEST_NAME_RE.search(current):
            raise RuntimeError(f'refusing to truncate non-test database "{current}"')
        tables = c.execute(
            text(
                "SELECT tablename FROM pg_tables "
                "WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'"
            )
        ).scalars().all()
        if tables:
            joined = ", ".join(f'"{t}"' for t in tables)
            c.execute(text(f"TRUNCATE {joined} RESTART IDENTITY CASCADE"))
    yield eng
    eng.dispose()
    scraper_db._engine = None
    scraper_db._metadata = None
    scraper_db._SessionLocal = None
