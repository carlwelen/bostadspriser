"""Calendar bounds shared by source ingestion and durable crawl coverage."""
from datetime import date, datetime
from zoneinfo import ZoneInfo

STOCKHOLM = ZoneInfo("Europe/Stockholm")


def stockholm_today() -> date:
    return datetime.now(STOCKHOLM).date()
