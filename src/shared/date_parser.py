"""
Robust multi-format date parser.
Extracts (year, month) from datetime objects, Excel serial numbers,
ISO dates, Chinese dates, and year-month formats.
"""
import re
import datetime as _dt
import pandas as pd
import numpy as np


def parse_date(val):
    """
    Parse a value into (year, month).
    Supports: '2024-01-15', '2024/1/15', '2024年1月', '2024-01',
              Excel serial numbers (45292), datetime objects, Timestamp.
    Returns (year, month) or (None, None).
    """
    if val is None:
        return None, None

    # pandas Timestamp / Python datetime
    if isinstance(val, (_dt.datetime, _dt.date, pd.Timestamp)):
        return val.year, val.month

    # Numeric (Excel serial: 1900-01-01 = 1)
    if isinstance(val, (int, float, np.integer, np.floating)):
        if 3000 < val < 100000:  # Reasonable Excel date range (1900-2170)
            try:
                base = _dt.datetime(1899, 12, 30)
                dt = base + _dt.timedelta(days=int(val))
                return dt.year, dt.month
            except Exception:
                pass
        if 2000 <= val <= 2100:  # Might be just a year
            return int(val), None
        return None, None

    s = str(val).strip()
    if not s:
        return None, None

    # Try various formats
    formats = [
        # ISO variants
        (r'^(\d{4})-(\d{1,2})-(\d{1,2})$', 1, 2),
        (r'^(\d{4})/(\d{1,2})/(\d{1,2})$', 1, 2),
        (r'^(\d{4})\.(\d{1,2})\.(\d{1,2})$', 1, 2),
        # Year-Month only
        (r'^(\d{4})-(\d{1,2})$', 1, 2),
        (r'^(\d{4})/(\d{1,2})$', 1, 2),
        # Chinese
        (r'^(\d{4})年(\d{1,2})月(\d{1,2})日?$', 1, 2),
        (r'^(\d{4})年(\d{1,2})月$', 1, 2),
    ]

    for pattern, yi, mi in formats:
        m = re.match(pattern, s)
        if m:
            y, mo = int(m.group(yi)), int(m.group(mi))
            if 2000 <= y <= 2100 and 1 <= mo <= 12:
                return y, mo

    return None, None
