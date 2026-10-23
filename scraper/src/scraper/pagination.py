"""Helpers shared by the source crawlers' pagination guards."""

from __future__ import annotations

import hashlib
import json


def card_key(card: dict, card_id: str | None) -> str:
    """Identity of a card within one crawl: its id, or a content fingerprint.

    Cards without an id still need an identity, otherwise a repeated page of
    id-less cards would slip past the "nothing new on this page" guard.
    """
    if card_id:
        return f"id:{card_id}"
    blob = json.dumps(card, sort_keys=True, default=str)
    return "sha1:" + hashlib.sha1(blob.encode("utf-8")).hexdigest()  # noqa: S324 - not security
