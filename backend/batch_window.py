"""Check an operator-provided remaining open-time window for a single batch."""
from math import isfinite
from typing import Optional


def batch_remaining_seconds(age_minutes: Optional[float], open_minutes: Optional[float]) -> Optional[float]:
    if age_minutes is None and open_minutes is None:
        return None
    if age_minutes is None or open_minutes is None:
        raise ValueError('Enter both the batch age at print start and the mix open time.')
    if not isfinite(age_minutes) or not isfinite(open_minutes) or age_minutes < 0 or open_minutes <= 0:
        raise ValueError('Enter a nonnegative batch age and a positive mix open time.')
    if age_minutes >= open_minutes:
        raise ValueError('The batch will already be past its open time when printing starts.')
    return (open_minutes - age_minutes) * 60
