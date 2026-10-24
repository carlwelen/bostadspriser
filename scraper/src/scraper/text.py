"""Street URL slugs and search keys matching web/src/lib/text.ts.

The contract lives in shared/slug-vectors.json. URL slugs deliberately fold fewer
characters than search keys so existing street URLs remain unchanged.
"""
from __future__ import annotations

import re

_BASE_FOLD = {"å": "a", "ä": "a", "ö": "o", "é": "e"}
_SEARCH_FOLD = {**_BASE_FOLD, "è": "e", "ü": "u"}
# JavaScript's whitespace class, including NBSP/BOM; Python's \s differs.
_SEARCH_SPACE = re.compile(r"[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+")


def slugify_street(name: str) -> str:
    """Stable ASCII URL slug: S:t Eriksgatan -> s-t-eriksgatan."""
    folded = name.lower().translate(str.maketrans(_BASE_FOLD))
    return re.sub(r"[^a-z0-9]+", "-", folded).strip("-")


def fold_for_search(value: str) -> str:
    """Case/diacritic-insensitive search key with collapsed whitespace."""
    folded = value.lower().translate(str.maketrans(_SEARCH_FOLD))
    return _SEARCH_SPACE.sub(" ", folded).strip(" ")
