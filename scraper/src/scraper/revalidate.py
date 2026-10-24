"""Best-effort invalidation of the web app's cached data after a snapshot refresh."""
from __future__ import annotations

import logging
import os
from urllib.parse import urlsplit, urlunsplit

import httpx

log = logging.getLogger("scraper.revalidate")


def revalidate_app() -> None:
    """Notify only the configured app origin; failures never fail a writing command."""
    try:
        app_url = os.environ.get("APP_URL", "")
        secret = os.environ.get("REVALIDATE_SECRET", "")
        if not app_url and not secret:
            log.debug("app revalidation is not configured")
            return
        parts = urlsplit(app_url)
        # APP_URL is an origin, not a token-bearing URL or an arbitrary endpoint.
        # Reject credentials/query/fragment rather than forwarding or logging them.
        if (len(secret) < 16 or parts.scheme not in {"http", "https"}
                or not parts.hostname or parts.username is not None or parts.password is not None
                or parts.path not in {"", "/"} or parts.query or parts.fragment
                or any(c.isspace() for c in app_url)):
            log.warning("app revalidation skipped: invalid or incomplete configuration")
            return
        endpoint = urlunsplit((parts.scheme, parts.netloc, "/api/revalidate", "", ""))
        # No redirects, proxy inheritance, retries or response-body reads. In
        # particular, an app redirect must never send the bearer token elsewhere.
        with httpx.Client(timeout=5.0, follow_redirects=False, trust_env=False) as client:
            with client.stream("POST", endpoint, headers={"Authorization": f"Bearer {secret}"}) as response:
                if not 200 <= response.status_code < 300:
                    log.warning("app revalidation failed status=%d", response.status_code)
    except Exception:  # noqa: BLE001
        # Exception text, URLs and response bodies may contain credentials.
        log.warning("app revalidation failed; check app connectivity and configuration")
