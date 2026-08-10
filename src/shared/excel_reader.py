"""
Excel file reading utilities.
"""
import pandas as pd
import warnings


def pd_read_excel(filepath):
    """Read an Excel file with warnings suppressed."""
    with warnings.catch_warnings():
        warnings.simplefilter('ignore')
        return pd.read_excel(filepath)


def read_excel_with_columns(filepath, column_mapping):
    """
    Read Excel with a confirmed column mapping, return standardized DataFrame.
    Only keeps mapped columns and renames them to standard field names.
    """
    df = pd_read_excel(filepath)

    # Reverse mapping: original column name → standard field name
    rev_map = {}
    for field_key, col_name in column_mapping.items():
        if col_name and col_name in df.columns:
            rev_map[col_name] = field_key

    # Keep only mapped columns
    keep_cols = [c for c in df.columns if c in rev_map]
    df = df[keep_cols].rename(columns=rev_map)

    return df
