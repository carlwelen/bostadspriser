"""B23: Python and TypeScript share the same stable slug/search contract."""
import json
from pathlib import Path

import pytest

VECTORS = json.loads((Path(__file__).resolve().parents[2] / "shared" / "slug-vectors.json").read_text())


@pytest.mark.parametrize("vector", VECTORS["slug"], ids=lambda v: v["input"])
def test_shared_street_slug_vectors(vector):
    from scraper.text import slugify_street

    assert slugify_street(vector["input"]) == vector["expected"]


@pytest.mark.parametrize("vector", VECTORS["fold"], ids=lambda v: v["input"])
def test_shared_search_fold_vectors(vector):
    from scraper.text import fold_for_search

    assert fold_for_search(vector["input"]) == vector["expected"]
