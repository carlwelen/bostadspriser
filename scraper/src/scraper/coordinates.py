"""Treat source coordinates as a complete, finite pair in the global domain."""
import math


def normalize_coordinates(lat, lng) -> tuple[float | None, float | None]:
    if isinstance(lat, bool) or isinstance(lng, bool):
        return None, None
    try:
        lat, lng = float(lat), float(lng)
    except (TypeError, ValueError, OverflowError):
        return None, None
    if not (math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180):
        return None, None
    return lat, lng
