"""String parsers for Hemnet's localized SaleCard fields.

Hemnet ships values like "4 900 000 kr", "35 m²", "2,5 rum" — Swedish formatting
with non-breaking spaces and comma decimals. These helpers tolerate the variants
and return numeric types or None.
"""

from __future__ import annotations

import re
from decimal import ROUND_HALF_UP, Decimal

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

# <street> <number>[ ]?<letter>? with an optional "-<number><letter>?" range.
# Everything after the first house number (floor, apartment, "lgh 1101", "1,5 tr",
# "ög", "3 vån", "64/66", ...) is a tail we deliberately ignore, so the first
# number always wins and no tail can leak into the street. The street is lazy:
# the first "<space><digits>" ends it. A letter must stand alone ("3A", "3 A")
# and not start a word ("64 nb", "7 vån") or an abbreviation ("o.g.").
# [0-9], not \d: \d also matches Arabic-Indic and full-width digits.
# A floor or apartment marker right after the range's second number means it is
# not a range end ("2 - 3 tr" is house 2, third floor).
_FLOOR_MARKER = r"(?!\s*(?:tr|trp|trappa|trappor|vån|lgh|nb|bv|[½/]))"
_ADDR_RE = re.compile(
    r"^(?P<street>.+?)\s+"
    r"(?P<n1>[0-9]{1,3})(?:\s?(?P<l1>[A-Za-z])(?!\w|\.\w))?(?![0-9])"
    r"(?:\s*[-–—]\s*(?P<n2>[0-9]{1,3})(?:\s?(?P<l2>[A-Za-z])(?!\w|\.\w))?(?![0-9])"
    + _FLOOR_MARKER
    + r")?",
    re.IGNORECASE,
)

# A real street name has a word of at least two letters; "12" and "12 B" don't.
_STREET_WORD_RE = re.compile(r"[^\W\d_]{2}")


def parse_street_address(addr: str | None) -> tuple[str, str | None]:
    """Split a source address into (street, canonical house number).

    'Sankt Eriksgatan 10 B' -> ('Sankt Eriksgatan', '10B')
    'Ringvägen 12-14'       -> ('Ringvägen', '12-14')
    'Odengatan 5, lgh 1101' -> ('Odengatan', '5')
    'Hornsgatan 64 1,5 tr'  -> ('Hornsgatan', '64')
    'Fjällgatan 2A-B'       -> ('Fjällgatan', '2A')
    'Mariatorget'           -> ('Mariatorget', None)

    The house number is digits plus an optional uppercase letter with no space.
    Number ranges keep the hyphen ("12-14"); letter ranges ("2A-B") reduce to the
    first entrance ("2A"); anything else after the number is dropped. The street
    name is returned as spelled by the source (no S:t/Sankt rewriting). With no
    number the whole address is the street and house is None. A street without
    a word of two letters ("12", "12 B") is not an address: returns ("", None) so callers
    skip the row.
    """
    text = re.sub(r"\s+", " ", (addr or "")).strip()
    # "Odengatan 5, lgh 1101": a comma starts the tail, unless it is a decimal
    # comma, i.e. has a digit on both sides ("1,5 tr").
    head = re.split(r"(?<![0-9]),|,(?![0-9])", text, maxsplit=1)[0].strip()
    m = _ADDR_RE.match(head)
    if not m and re.search(r"\s[0-9]", head):
        # Looks numeric but doesn't parse ("Hornsgatan 1234"): reject rather than
        # store a street name with digits in it.
        return "", None
    street: str = m["street"].strip() if m else head
    house: str | None = None
    if m:
        # int() strips leading zeros ("064" -> "64").
        house = f"{int(m['n1'])}{(m['l1'] or '').upper()}"
        # A range must ascend: "64 - 2 tr" is a floor, not "64-2".
        if m["n2"] and int(m["n2"]) > int(m["n1"]):
            house += f"-{int(m['n2'])}{(m['l2'] or '').upper()}"
    # A street name has a real word and no digits ("Hornsgatan64", "1 Hornsgatan"
    # are not addresses). Roman numerals ("Karl XII:s torg") are letters.
    if not _STREET_WORD_RE.search(street) or any(c.isdigit() for c in street):
        return "", None
    return street, house


def resolve_prices(
    price_sek: int | None, per_sqm_sek: int | None, area_sqm: float | None
) -> tuple[int, int] | None:
    """Final price and kr/m² for a sale, or None if the row can't be stored.

    A sale without a final price is skipped (the columns are NOT NULL and a 0
    would drag averages down and produce `::0` dedup keys). A missing kr/m² is
    derived as round(price / area); with neither kr/m² nor a usable area the
    row is skipped rather than stored with 0.
    """
    if not price_sek:
        return None
    if not per_sqm_sek:
        if not area_sqm:
            return None
        per_sqm_sek = int(round(price_sek / area_sqm))
    return int(price_sek), int(per_sqm_sek)


def round_1dp(value: float | None) -> float | None:
    """Round like Postgres does for the Decimal(_, 1) columns (half away from zero).

    Applied to rooms and areaSqm before they leave the parsers so what an insert
    stores and what `reparse` derives are the same number (35.25 -> 35.3).
    """
    if value is None:
        return None
    return float(Decimal(str(value)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


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
