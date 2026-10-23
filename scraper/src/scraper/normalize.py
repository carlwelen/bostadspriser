"""String parsers for Hemnet's localized SaleCard fields.

Hemnet ships values like "4 900 000 kr", "35 m²", "2,5 rum" — Swedish formatting
with non-breaking spaces and comma decimals. These helpers tolerate the variants
and return numeric types or None.
"""

from __future__ import annotations

import re

# Matches digit groups with optional non-breaking/regular spaces.
_DIGIT_RE = re.compile(r"[\d \s]+")
_DECIMAL_RE = re.compile(r"\d+(?:[.,]\d+)?")


def parse_sek(text: str | None) -> int | None:
    """'4 900 000 kr' or '140 000 kr/m²' → 4900000 / 140000."""
    if not text:
        return None
    digits = re.sub(r"[^\d]", "", text)
    return int(digits) if digits else None


def parse_sqm(text: str | None) -> float | None:
    """'35 m²' → 35.0; '79,5 m²' → 79.5."""
    if not text:
        return None
    m = _DECIMAL_RE.search(text.replace(" ", " "))
    return float(m.group(0).replace(",", ".")) if m else None


def parse_rooms(text: str | None) -> float | None:
    """'1 rum' → 1.0; '2,5 rum' → 2.5."""
    return parse_sqm(text)


# --------------------------------------------------------------------------
# Street addresses
# --------------------------------------------------------------------------

# Trailing floor/apartment noise that sources append after the house number:
# "lgh 1101", "1tr", "2 tr", "vån 3", "nb", "bv", a bare 4-digit apartment
# number, or anything in parentheses.
_ADDR_NOISE = (
    r"(?:lgh\.?\s*\d+|\d+\s*(?:tr|trp|trappor?)\.?|vån\.?\s*\d+|nb|bv|\d{4}|\([^)]*\))"
)
# <street> <number>[ ]?<letter>? with an optional "-<number><letter>?" range,
# then nothing but noise. The street is lazy so the *first* number that leaves
# only noise behind wins ("Hornsgatan 64 1tr" -> 64, not 1).
_ADDR_RE = re.compile(
    r"^(?P<street>.+?)\s+"
    r"(?P<n1>\d{1,3})\s?(?P<l1>[A-Za-z])?(?!\w)"
    r"(?:\s*[-–—]\s*(?P<n2>\d{1,3})\s?(?P<l2>[A-Za-z])?(?!\w))?"
    rf"(?:\s+{_ADDR_NOISE})*$",
    re.IGNORECASE,
)


def parse_street_address(addr: str | None) -> tuple[str, str | None]:
    """Split a source address into (street, canonical house number).

    'Sankt Eriksgatan 10 B' -> ('Sankt Eriksgatan', '10B')
    'Ringvägen 12-14'       -> ('Ringvägen', '12-14')
    'Odengatan 5, lgh 1101' -> ('Odengatan', '5')
    'Mariatorget'           -> ('Mariatorget', None)

    The house number is digits plus an optional uppercase letter with no space;
    ranges keep the hyphen; floor/apartment noise is dropped. The street name is
    returned as spelled by the source (no S:t/Sankt rewriting). Anything that
    doesn't look like "<street> <number>" comes back whole with house None.
    """
    text = re.sub(r"\s+", " ", (addr or "")).strip()
    # "Odengatan 5, lgh 1101": a comma always starts the noise.
    head = text.split(",", 1)[0].strip()
    m = _ADDR_RE.match(head)
    if not m:
        return head, None
    house = f"{m['n1']}{(m['l1'] or '').upper()}"
    if m["n2"]:
        house += f"-{m['n2']}{(m['l2'] or '').upper()}"
    return m["street"].strip(), house


DISTRICT_ALIASES = {
    "östermalm": "ostermalm",
    "ostermalm": "ostermalm",
    "vasastan": "vasastan",
    "norrmalm": "norrmalm",
    "södermalm": "sodermalm",
    "sodermalm": "sodermalm",
}


def normalize_district(raw: str) -> str | None:
    return DISTRICT_ALIASES.get(raw.strip().lower())


# --------------------------------------------------------------------------
# Dedup
# --------------------------------------------------------------------------

import hashlib  # noqa: E402  — local import keeps the module's top tidy
from datetime import date  # noqa: E402

# Map Swedish letters to their ASCII fallback so "Brahegatan" and "Brahégatan"
# (or any stray diacritic from one source) collapse to the same key.
_SWE_FOLD = str.maketrans({
    "å": "a", "ä": "a", "ö": "o", "é": "e", "è": "e",
    "Å": "a", "Ä": "a", "Ö": "o", "É": "e", "È": "e",
})


def normalize_address(street: str, house_number: str | None) -> str:
    """Aggressive normalization for dedup. Two sources that disagree on spaces,
    case, hyphens, or diacritics in `Brahegatan 3A` vs `brahégatan 3 a` should
    still produce the same canonical token. Purely deterministic — no I/O.
    """
    raw = (street or "") + " " + (house_number or "")
    folded = raw.translate(_SWE_FOLD).lower()
    # Strip everything except [a-z0-9]; this also collapses "3 A" into "3a".
    return "".join(c for c in folded if c.isalnum())


def dedup_key(street: str, house_number: str | None, sold_at: date, price_sek: int) -> str:
    """Stable 16-char hex key identifying one real-world transaction.

    The same physical sale observed via Hemnet and Booli must produce the same
    output. Aggregations dedup on this key so a single sale isn't double-counted.
    """
    addr = normalize_address(street, house_number)
    payload = f"{addr}::{sold_at.isoformat()}::{int(price_sek)}"
    return hashlib.blake2b(payload.encode("utf-8"), digest_size=8).hexdigest()
