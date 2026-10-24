"""B49: hermetic notifications after successful, committed snapshot refreshes."""
import logging

import httpx
import pytest

from scraper import db as database
from scraper import revalidate
from scraper.run import cli
from click.testing import CliRunner
from tests import test_refresh_view as refresh_fixtures
from tests.test_refresh_view import FAILING_STUB, LOCK_STUB

# Register the existing safe test-DB fixtures in this module as well.
audit = refresh_fixtures.audit
use_function = refresh_fixtures.use_function

SECRET = "fixture-secret-16-chars"


class UnreadableBody(httpx.SyncByteStream):
    def __iter__(self):
        raise AssertionError("notification must not consume a response body")


@pytest.fixture()
def requests(monkeypatch, audit):
    monkeypatch.setenv("APP_URL", "https://app.example")
    monkeypatch.setenv("REVALIDATE_SECRET", SECRET)
    seen = []
    real_client = httpx.Client

    def handler(request):
        assert audit() == 1  # notification happens after the refresh transaction committed
        seen.append(request)
        return httpx.Response(200, stream=UnreadableBody())

    def client(**kwargs):
        assert kwargs["timeout"] == 5.0
        assert kwargs["follow_redirects"] is False
        assert kwargs["trust_env"] is False
        return real_client(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(revalidate.httpx, "Client", client)
    return seen


def test_successful_refresh_notifies_after_transaction_commit(db, audit, requests):
    assert database.refresh_deduped() == "refreshed"
    assert audit() == 1
    assert len(requests) == 1
    request = requests[0]
    assert request.method == "POST"
    assert str(request.url) == "https://app.example/api/revalidate"
    assert request.headers["authorization"] == f"Bearer {SECRET}"


@pytest.mark.parametrize("stub", [None, FAILING_STUB, LOCK_STUB])
def test_failed_missing_or_busy_refresh_never_notifies(stub, use_function, requests):
    use_function(stub)
    assert database.refresh_deduped() != "refreshed"
    assert requests == []


def test_manual_refresh_view_uses_the_same_notification_path(db, audit, requests):
    result = CliRunner().invoke(cli, ["refresh-view"])
    assert result.exit_code == 0, result.output
    assert len(requests) == 1


@pytest.mark.parametrize("name,value", [
    ("APP_URL", ""), ("REVALIDATE_SECRET", ""), ("REVALIDATE_SECRET", "short"), ("REVALIDATE_SECRET", "x" * 15),
    ("APP_URL", "ftp://app.example"), ("APP_URL", "https://name:password@app.example"),
    ("APP_URL", "https://app.example/?token=confidential"),
    ("APP_URL", "https://app.example/#confidential"),
    ("APP_URL", "https://app.example/confidential"),
])
def test_missing_or_invalid_config_is_safe_no_op(name, value, monkeypatch, requests, db, audit, caplog):
    monkeypatch.setenv(name, value)
    assert database.refresh_deduped() == "refreshed"
    assert requests == []
    assert SECRET not in caplog.text
    assert "confidential" not in caplog.text
    assert "password" not in caplog.text


@pytest.mark.parametrize("failure", [301, 307, 401, 500, "timeout", "exception"])
def test_notification_failure_never_aborts_or_leaks_secrets(failure, monkeypatch, db, audit, caplog):
    monkeypatch.setenv("APP_URL", "https://app.example")
    monkeypatch.setenv("REVALIDATE_SECRET", SECRET)
    seen = []
    real_client = httpx.Client

    def handler(request):
        seen.append(request)
        if failure == "timeout":
            raise httpx.ReadTimeout(f"secret={SECRET}", request=request)
        if failure == "exception":
            raise RuntimeError(f"secret={SECRET}")
        return httpx.Response(failure, headers={"location": "https://other.example/"}, text=SECRET)

    monkeypatch.setattr(revalidate.httpx, "Client", lambda **kwargs: real_client(
        transport=httpx.MockTransport(handler), **kwargs))
    caplog.set_level(logging.WARNING)
    assert database.refresh_deduped() == "refreshed"
    assert audit() == 1
    assert len(seen) == 1
    assert any("revalidation" in r.message for r in caplog.records)
    assert SECRET not in caplog.text
    assert "other.example" not in caplog.text


def test_minimum_secret_length_and_trailing_slash_are_supported(monkeypatch, db, audit, requests):
    monkeypatch.setenv("APP_URL", "http://localhost:3106/")
    monkeypatch.setenv("REVALIDATE_SECRET", "0123456789abcdef")
    assert database.refresh_deduped() == "refreshed"
    assert len(requests) == 1
    assert str(requests[0].url) == "http://localhost:3106/api/revalidate"
    assert requests[0].headers["authorization"] == "Bearer 0123456789abcdef"
