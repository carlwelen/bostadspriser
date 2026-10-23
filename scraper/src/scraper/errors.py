"""Exceptions shared by the sources and the CLI."""

from __future__ import annotations


class CrawlIncomplete(Exception):
    """A source iterator stopped before reaching its natural end (a page fetch
    failed, or the page cap was hit).

    Raised by `iter_district` only after every row it did get has been yielded,
    so callers keep those rows and mark the source/district as partial.
    """
