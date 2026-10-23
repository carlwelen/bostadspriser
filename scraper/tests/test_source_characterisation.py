"""Characterisation of the per-source browser/fetch layer (B17).

Pins the observable behaviour of Hemnet's and Booli's crawl plumbing so the
extraction into a shared core cannot change it: launch args, context options,
init script, warmup rule, cache file naming/rules, challenge detection, retry
counts, timeouts, polite delays and storageState handling. No browser, network
or sleeping: Playwright is faked and `asyncio.sleep` is recorded.

The only seam that moves with the refactor is `Seams` below.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import date

import pytest

from scraper import booli, hemnet, source_base
from scraper.config import load_config

# ---------------------------------------------------------------------------
# Seams: where each source's I/O hooks live. Adjusted by the B17 refactor only.
# ---------------------------------------------------------------------------


class Seams:
    def __init__(self, module) -> None:
        self.module = module

    def patch_playwright(self, monkeypatch, factory) -> None:
        monkeypatch.setattr(source_base, "async_playwright", factory)

    def patch_warmup(self, monkeypatch, fn) -> None:
        async def warmup(ctx, cfg, source):
            await fn(ctx, cfg)

        monkeypatch.setattr(source_base, "warmup", warmup)

    def patch_fetch(self, monkeypatch, fn) -> None:
        async def fetch(ctx, cfg, source, url):
            return await fn(ctx, cfg, url)

        monkeypatch.setattr(source_base, "fetch", fetch)

    async def fetch(self, ctx, cfg, url: str) -> str:
        return await source_base.fetch(ctx, cfg, self.module.SOURCE, url)

    async def warmup(self, ctx, cfg) -> None:
        await source_base.warmup(ctx, cfg, self.module.SOURCE)

    def looks_real(self, html: str) -> bool:
        return self.module._looks_real(html)

    def cache_path(self, cfg, url: str):
        return source_base.cache_path(cfg, url)

    async def polite_sleep(self, cfg) -> None:
        await source_base.polite_sleep(cfg)

    def iter_district(self, district: str, since: date):
        return self.module.iter_district(district, since)


SOURCES = {
    "hemnet": dict(
        seams=Seams(hemnet),
        ready="SaleCard",
        home="https://www.hemnet.se/",
        warm_marker="Söker du",
        real="<html>__APOLLO_STATE__ SaleCard</html>",
        typename="SaleCard",
    ),
    "booli": dict(
        seams=Seams(booli),
        ready="SoldProperty",
        home="https://www.booli.se/",
        warm_marker="Sök bostäder",
        real="<html>__APOLLO_STATE__ SoldProperty</html>",
        typename="SoldProperty",
    ),
}
CHALLENGE = "<html><title>Just a moment...</title></html>"


@pytest.fixture(params=sorted(SOURCES))
def src(request):
    return SOURCES[request.param]


@pytest.fixture()
def sleeps(monkeypatch) -> list[float]:
    """Record asyncio.sleep calls instead of sleeping (covers tenacity's waits too)."""
    recorded: list[float] = []

    async def fake_sleep(delay, *a, **k):
        recorded.append(delay)

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    return recorded


@pytest.fixture()
def cfg(tmp_path, monkeypatch):
    """Config pointing the HTML cache at a fresh dir; delays 3000-5000 ms as in production."""
    base = load_config()
    monkeypatch.setenv("SCRAPER_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setenv("SCRAPER_MIN_DELAY_MS", "3000")
    monkeypatch.setenv("SCRAPER_MAX_DELAY_MS", "5000")
    c = load_config()
    assert c.cache_dir != base.cache_dir
    return c


# ---------------------------------------------------------------------------
# Fake page/context for _fetch and _warmup
# ---------------------------------------------------------------------------


class _Resp:
    def __init__(self, status: int) -> None:
        self.status = status


class FakePage:
    def __init__(self, ctx: FakeCtx) -> None:
        self.ctx = ctx
        self.closed = False

    async def goto(self, url, wait_until=None, timeout=None):
        self.ctx.goto_calls.append((url, wait_until, timeout))
        return _Resp(self.ctx.status) if self.ctx.status is not None else None

    async def wait_for_function(self, js, timeout=None):
        self.ctx.wait_calls.append((js, timeout))
        if self.ctx.wait_raises:
            raise TimeoutError("not ready")

    async def content(self) -> str:
        self.ctx.content_calls += 1
        seq = self.ctx.contents
        return seq.pop(0) if len(seq) > 1 else seq[0]

    async def close(self) -> None:
        self.closed = True
        self.ctx.closed_pages += 1


class FakeCtx:
    def __init__(self, contents: list[str], status: int | None = 200, wait_raises: bool = False) -> None:
        self.contents = list(contents)
        self.status = status
        self.wait_raises = wait_raises
        self.goto_calls: list[tuple] = []
        self.wait_calls: list[tuple] = []
        self.content_calls = 0
        self.pages = 0
        self.closed_pages = 0

    async def new_page(self) -> FakePage:
        self.pages += 1
        return FakePage(self)


URL = "https://example.test/list?page=1"


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def test_cache_path_is_dated_and_keyed_by_url_hash(src, cfg) -> None:
    expected = f"{date.today().isoformat()}_{hashlib.sha256(URL.encode()).hexdigest()[:16]}.html"
    path = src["seams"].cache_path(cfg, URL)
    assert path.name == expected
    assert path.parent == cfg.cache_dir


@pytest.mark.parametrize("seed", range(3))
def test_polite_sleep_is_jittered_within_configured_bounds(src, cfg, sleeps, seed) -> None:
    import random

    random.seed(seed)
    asyncio.run(src["seams"].polite_sleep(cfg))
    assert len(sleeps) == 1 and 3.0 <= sleeps[0] <= 5.0


def test_looks_real_rejects_challenges_and_missing_state(src) -> None:
    looks_real = src["seams"].looks_real
    assert looks_real(src["real"])
    assert not looks_real("<html>no state here</html>")
    assert not looks_real(src["real"] + " Just a moment")
    assert not looks_real(src["real"] + "<title>Vänta")


def test_booli_additionally_requires_sold_property_or_search_marker() -> None:
    assert not booli._looks_real("<html>__APOLLO_STATE__ only</html>")
    assert booli._looks_real("<html>__APOLLO_STATE__ propertySearch</html>")
    # Hemnet only needs the Apollo state.
    assert hemnet._looks_real("<html>__APOLLO_STATE__ only</html>")


# ---------------------------------------------------------------------------
# _fetch
# ---------------------------------------------------------------------------


def test_fetch_returns_a_real_cached_page_without_opening_a_browser_page(src, cfg, sleeps) -> None:
    s = src["seams"]
    cfg.cache_dir.mkdir(parents=True, exist_ok=True)
    s.cache_path(cfg, URL).write_text(src["real"], encoding="utf-8")
    ctx = FakeCtx([CHALLENGE])
    assert asyncio.run(s.fetch(ctx, cfg, URL)) == src["real"]
    assert ctx.pages == 0 and sleeps == []


def test_fetch_drops_a_cached_challenge_and_refetches(src, cfg, sleeps) -> None:
    s = src["seams"]
    cfg.cache_dir.mkdir(parents=True, exist_ok=True)
    cache = s.cache_path(cfg, URL)
    cache.write_text(CHALLENGE, encoding="utf-8")
    ctx = FakeCtx([src["real"]])
    assert asyncio.run(s.fetch(ctx, cfg, URL)) == src["real"]
    assert ctx.pages == 1
    assert cache.read_text(encoding="utf-8") == src["real"]  # replaced by the real page


def test_fetch_success_navigates_waits_caches_and_paces(src, cfg, sleeps) -> None:
    s = src["seams"]
    ctx = FakeCtx([src["real"]])
    assert asyncio.run(s.fetch(ctx, cfg, URL)) == src["real"]
    assert ctx.goto_calls == [(URL, "domcontentloaded", 45_000)]
    (js, timeout), = ctx.wait_calls
    assert timeout == 25_000
    assert "script#__NEXT_DATA__" in js and "__APOLLO_STATE__" in js and src["ready"] in js
    assert ctx.closed_pages == 1
    assert s.cache_path(cfg, URL).read_text(encoding="utf-8") == src["real"]
    assert len(sleeps) == 1 and 3.0 <= sleeps[0] <= 5.0  # one polite delay after a live fetch


def test_fetch_polls_until_the_challenge_resolves(src, cfg, sleeps) -> None:
    s = src["seams"]
    ctx = FakeCtx([CHALLENGE, CHALLENGE, src["real"]], wait_raises=True)  # wait timeout is tolerated
    assert asyncio.run(s.fetch(ctx, cfg, URL)) == src["real"]
    assert ctx.pages == 1 and ctx.content_calls == 3
    assert sleeps[:2] == [1.5, 1.5]


def test_fetch_gives_up_after_two_attempts_and_never_caches_a_challenge(src, cfg, sleeps) -> None:
    s = src["seams"]
    ctx = FakeCtx([CHALLENGE])
    with pytest.raises(RuntimeError, match="Cloudflare challenge did not resolve"):
        asyncio.run(s.fetch(ctx, cfg, URL))
    assert ctx.pages == 2  # stop_after_attempt(2)
    assert ctx.content_calls == 16  # 8 polls per attempt
    assert ctx.closed_pages == 2
    assert not s.cache_path(cfg, URL).exists()
    # 8 polls per attempt, each followed by 1.5 s; tenacity waits exactly 10 s
    # (wait_exponential(multiplier=2, min=10, max=60), first retry) between attempts.
    assert sleeps == [1.5] * 8 + [10] + [1.5] * 8


@pytest.mark.parametrize("status", [429, 503])
def test_fetch_treats_rate_limits_as_errors(src, cfg, sleeps, status) -> None:
    s = src["seams"]
    ctx = FakeCtx([src["real"]], status=status)
    with pytest.raises(RuntimeError, match=f"rate limited: {status}"):
        asyncio.run(s.fetch(ctx, cfg, URL))
    assert ctx.pages == 2 and ctx.content_calls == 0
    assert not s.cache_path(cfg, URL).exists()


def test_fetch_tolerates_a_missing_response_object(src, cfg, sleeps) -> None:
    ctx = FakeCtx([src["real"]], status=None)
    assert asyncio.run(src["seams"].fetch(ctx, cfg, URL)) == src["real"]


# ---------------------------------------------------------------------------
# _warmup
# ---------------------------------------------------------------------------


def test_warmup_visits_the_homepage_until_it_looks_settled(src, cfg, sleeps) -> None:
    ctx = FakeCtx(["<html>loading</html>", "<html>loading</html>", f"<html>{src['warm_marker']}</html>"])
    asyncio.run(src["seams"].warmup(ctx, cfg))
    assert ctx.goto_calls == [(src["home"], "domcontentloaded", 60_000)]
    assert ctx.content_calls == 3 and sleeps == [1.0, 1.0]
    assert ctx.closed_pages == 1


def test_warmup_gives_up_after_twenty_polls(src, cfg, sleeps) -> None:
    ctx = FakeCtx(["<html>loading</html>"])
    asyncio.run(src["seams"].warmup(ctx, cfg))
    assert ctx.content_calls == 20 and sleeps == [1.0] * 20
    assert ctx.closed_pages == 1


# ---------------------------------------------------------------------------
# iter_district: browser launch, context, init script, warmup rule, state saving
# ---------------------------------------------------------------------------

LAUNCH_ARGS = [
    "--disable-blink-features=AutomationControlled",
    "--disable-features=IsolateOrigins,site-per-process",
    "--no-sandbox",
]
CONTEXT_KWARGS = {
    "user_agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "viewport": {"width": 1440, "height": 900},
    "locale": "sv-SE",
    "timezone_id": "Europe/Stockholm",
    "extra_http_headers": {"Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8"},
}
INIT_SCRIPT = (
    "Object.defineProperty(navigator, 'webdriver', { get: () => undefined });"
    "Object.defineProperty(navigator, 'languages', { get: () => ['sv-SE','sv','en'] });"
    "Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });"
)


class RecordingPW:
    def __init__(self) -> None:
        self.launch_kwargs: dict | None = None
        self.ctx_kwargs: dict | None = None
        self.init_scripts: list[str] = []
        self.storage_saved: list[str] = []
        self.events: list[str] = []
        pw = self

        class Ctx:
            async def add_init_script(self, script):
                pw.init_scripts.append(script)

            async def storage_state(self, path=None):
                pw.storage_saved.append(path)
                pw.events.append("storage_state")

            async def close(self):
                pw.events.append("ctx.close")

        class Browser:
            async def new_context(self, **kw):
                pw.ctx_kwargs = kw
                return Ctx()

            async def close(self):
                pw.events.append("browser.close")

        class Chromium:
            async def launch(self, **kw):
                pw.launch_kwargs = kw
                return Browser()

        self.chromium = Chromium()

    def __call__(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return None


def _run_empty_crawl(src, monkeypatch, state_exists: bool, cfg_state_path):
    # Never create or delete anything outside conftest's temp dir (e.g. the real
    # scraper/.state/storageState.json).
    assert "scraper-tests-" in str(cfg_state_path), cfg_state_path
    s = src["seams"]
    pw = RecordingPW()
    warmups: list[int] = []

    async def fake_warmup(ctx, cfg):
        warmups.append(1)

    async def fake_fetch(ctx, cfg, url):
        return "<html>empty</html>"

    s.patch_playwright(monkeypatch, pw)
    s.patch_warmup(monkeypatch, fake_warmup)
    s.patch_fetch(monkeypatch, fake_fetch)
    if state_exists:
        cfg_state_path.parent.mkdir(parents=True, exist_ok=True)
        cfg_state_path.write_text("{}", encoding="utf-8")
    else:
        cfg_state_path.unlink(missing_ok=True)

    async def collect():
        return [r async for r in s.iter_district("ostermalm", date(2026, 5, 1))]

    try:
        rows = asyncio.run(collect())
    finally:
        cfg_state_path.unlink(missing_ok=True)
    return pw, warmups, rows


def test_browser_is_launched_headless_with_the_pinned_args_and_context(src, monkeypatch) -> None:
    state = load_config().storage_state_path
    pw, warmups, rows = _run_empty_crawl(src, monkeypatch, state_exists=False, cfg_state_path=state)
    assert rows == []
    assert pw.launch_kwargs == {"headless": True, "args": LAUNCH_ARGS}
    assert pw.ctx_kwargs == CONTEXT_KWARGS  # no storage_state when none exists
    assert pw.init_scripts == [INIT_SCRIPT]
    assert warmups == [1]  # first run without storage state warms up on the homepage


def test_existing_storage_state_is_reused_and_skips_warmup(src, monkeypatch) -> None:
    state = load_config().storage_state_path
    pw, warmups, _ = _run_empty_crawl(src, monkeypatch, state_exists=True, cfg_state_path=state)
    assert pw.ctx_kwargs == {**CONTEXT_KWARGS, "storage_state": str(state)}
    assert warmups == []


def test_storage_state_is_saved_then_context_and_browser_closed(src, monkeypatch) -> None:
    state = load_config().storage_state_path
    pw, _, _ = _run_empty_crawl(src, monkeypatch, state_exists=False, cfg_state_path=state)
    assert pw.storage_saved == [str(state)]
    assert pw.events == ["storage_state", "ctx.close", "browser.close"]


def test_unknown_district_is_rejected_before_any_browser_work(src, monkeypatch) -> None:
    s = src["seams"]
    pw = RecordingPW()
    s.patch_playwright(monkeypatch, pw)

    async def collect():
        return [r async for r in s.iter_district("kungsholmen", date(2026, 5, 1))]

    with pytest.raises(ValueError, match="unknown district: kungsholmen"):
        asyncio.run(collect())
    assert pw.launch_kwargs is None


def test_district_urls_are_pinned() -> None:
    assert hemnet._district_url("ostermalm", 3) == (
        "https://www.hemnet.se/salda/bostader?location_ids%5B%5D=473448&page=3"
    )
    assert booli._district_url("sodermalm", 2) == (
        "https://www.booli.se/sok/slutpriser?areaIds=115341&objectType=L%C3%A4genhet&page=2"
    )


def test_extractors_read_the_apollo_cache_by_typename(src) -> None:
    s = src["seams"]
    extract = getattr(s.module, "_extract_sale_cards" if s.module is hemnet else "_extract_sold_properties")
    state = {
        "a": {"__typename": src["typename"], "id": "1"},
        "b": {"__typename": "Other", "id": "2"},
        "c": "not a dict",
    }
    blob = json.dumps({"props": {"pageProps": {"__APOLLO_STATE__": state}}})
    html = f'<html><script id="__NEXT_DATA__" type="application/json">{blob}</script></html>'
    assert extract(html) == [{"__typename": src["typename"], "id": "1"}]
    assert extract("<html></html>") == []
    assert extract('<script id="__NEXT_DATA__" type="application/json">{not json</script>') == []
