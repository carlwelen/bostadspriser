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
from urllib.parse import parse_qsl, quote, unquote, urlsplit, urlunsplit

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


def with_options(url: str, extra: str) -> str:
    """`url` with libpq `options` extended by `extra` (appended to any existing value).

    The space inside the value must be encoded as %20, not "+": libpq does not decode
    "+" and rejects the option.
    """
    parts = urlsplit(url)
    params = parse_qsl(parts.query, keep_blank_values=True)
    existing = next((v for k, v in params if k == "options"), "")
    others = [f"{k}={v}" for k, v in params if k != "options"]
    options = f"{unquote(existing)} {extra}".strip()
    query = "&".join([*others, f"options={quote(options, safe='=')}"])
    return urlunsplit(parts._replace(query=query))


# A runaway statement (e.g. a refresh waiting on a lock) must fail the test, not hang
# the suite.
STATEMENT_TIMEOUT_MS = 60_000

# Point the scraper at the test DB up front so nothing can fall back to the dev
# DATABASE_URL from .env, even tests that forget to request `db`. Prisma (migrate
# deploy) gets the plain URL; the scraper's connections also carry the timeout.
TEST_DATABASE_URL = _test_database_url()
os.environ["DATABASE_URL"] = with_options(TEST_DATABASE_URL, f"-c statement_timeout={STATEMENT_TIMEOUT_MS}")


def pytest_sessionfinish(session, exitstatus) -> None:  # noqa: ARG001
    shutil.rmtree(_TMP, ignore_errors=True)


def reset_db_timezone(url: str) -> None:
    """`ALTER DATABASE <test db> RESET timezone` (idempotent, test databases only).

    The timezone test sets a non-UTC database default; a killed run could leave it
    behind on a shared test DB and skew every later run.
    """
    from sqlalchemy import create_engine, text

    name = urlsplit(url).path.lstrip("/")
    if not _TEST_NAME_RE.search(name):
        raise RuntimeError(f'refusing to alter non-test database "{name}"')
    eng = create_engine(url.replace("postgresql://", "postgresql+psycopg://", 1), isolation_level="AUTOCOMMIT")
    try:
        with eng.connect() as c:
            c.execute(text(f'ALTER DATABASE "{name}" RESET timezone'))
    finally:
        eng.dispose()


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
    reset_db_timezone(TEST_DATABASE_URL)
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


@pytest.fixture(autouse=True)
def _restore_scraper_logger():
    """`scraper --log-level` configures the `scraper` logger; don't let one test's
    level or stderr handler leak into the next."""
    import logging

    logger = logging.getLogger("scraper")
    level, handlers = logger.level, logger.handlers[:]
    yield
    logger.setLevel(level)
    logger.handlers[:] = handlers


class FakeScrapeRuns:
    """In-memory stand-in for scraper.scrape_run, so CLI tests need no database.

    `runs` holds one dict per started run, updated by bump/finish like the table.
    """

    def __init__(self) -> None:
        self.runs: list[dict] = []

    def start_run(self, source: str, district: str) -> str:
        self.runs.append(
            {"id": f"run-{len(self.runs) + 1}", "source": source, "district": district,
             "status": "running", "pages": 0, "rows_upserted": 0, "rows_rejected": 0,
             "oldest_sold_at": None, "error": None}
        )
        return self.runs[-1]["id"]

    def _get(self, run_id):
        return next(r for r in self.runs if r["id"] == run_id) if run_id else None

    def bump(self, run_id, *, pages, rows_upserted, rows_rejected, oldest_sold_at) -> None:
        r = self._get(run_id)
        if r:
            r.update(pages=pages, rows_upserted=rows_upserted, rows_rejected=rows_rejected,
                     oldest_sold_at=oldest_sold_at)

    def finish_run(self, run_id, status, *, pages, rows_upserted, rows_rejected, oldest_sold_at, error=None) -> None:
        assert status in ("ok", "partial", "failed")
        r = self._get(run_id)
        if r:
            r.update(status=status, pages=pages, rows_upserted=rows_upserted,
                     rows_rejected=rows_rejected, oldest_sold_at=oldest_sold_at, error=error)


@pytest.fixture(autouse=True)
def scrape_runs(request, monkeypatch):
    """Tests without the `db` fixture get an in-memory ScrapeRun recorder (and so
    never touch a possibly unmigrated database); tests with `db` use the real one."""
    if "db" in request.fixturenames:
        return None
    fake = FakeScrapeRuns()
    from scraper import scrape_run

    monkeypatch.setattr(scrape_run, "start_run", fake.start_run)
    monkeypatch.setattr(scrape_run, "bump", fake.bump)
    monkeypatch.setattr(scrape_run, "finish_run", fake.finish_run)
    # `update` relabels inline-coordinate rows at the end; no database in these tests.
    monkeypatch.setattr("scraper.run.mark_inline_pending", lambda: 0)
    return fake
