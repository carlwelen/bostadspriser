"""Single-instance lock for the scraper CLI (B43).

The scraper is a single worker by design (polite pacing, one browser identity,
shared storageState and crawl_state files). An `fcntl.flock` on
`<state dir>/update.lock` makes that hold across processes: a second `scrape`,
`update`, `backfill` or `reparse` while one is running exits with a clear message
instead of running concurrently. The kernel drops the lock when the process dies,
so a leftover file never blocks anything.
"""

from __future__ import annotations

import fcntl
import functools
import os
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, TypeVar

import click

from .config import load_config

F = TypeVar("F", bound=Callable[..., Any])

# EX_TEMPFAIL: "try again later", distinct from a failed run (1).
EXIT_BUSY = 75


class SingleInstanceError(Exception):
    """Another scraper process holds the lock."""


def lock_path() -> Path:
    return load_config().storage_state_path.parent / "update.lock"


@contextmanager
def single_instance() -> Iterator[None]:
    path = lock_path()
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o644)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as e:
            holder = os.pread(fd, 32, 0).decode(errors="replace").strip()
            who = f" (pid {holder})" if holder.isdigit() else ""
            raise SingleInstanceError(
                f"another scraper run{who} is in progress; lock held: {path}"
            ) from e
        os.ftruncate(fd, 0)
        os.write(fd, f"{os.getpid()}\n".encode())
        try:
            yield
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
    finally:
        os.close(fd)


def exclusive(fn: F) -> F:
    """Click command decorator: run `fn` under the single-instance lock."""

    @functools.wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        try:
            with single_instance():
                return fn(*args, **kwargs)
        except SingleInstanceError as e:
            click.echo(f"error: {e}", err=True)
            raise SystemExit(EXIT_BUSY) from None

    return wrapper  # type: ignore[return-value]
