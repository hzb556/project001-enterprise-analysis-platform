"""
Generic column-to-field matching engine.
Uses keyword scoring + greedy assignment to map Excel column names
to standard field keys defined by the caller.
"""
import re


def score_column(col_name, keywords):
    """
    Score a single column name against a field's keywords.
    Returns an integer score (0 = no match).
    """
    score = 0
    col_lower = str(col_name).lower().strip()
    col_clean = re.sub(r'[\s\-_/]+', '', col_lower)

    for kw in keywords:
        kw_lower = kw.lower().strip()
        kw_clean = re.sub(r'[\s\-_/]+', '', kw_lower)

        # Exact match (ignoring whitespace and symbols)
        if col_clean == kw_clean:
            score += 10
        # Contains keyword
        elif kw_clean in col_clean:
            score += 5
        # Column name starts with keyword
        elif col_clean.startswith(kw_clean):
            score += 4
        # Partial match (keyword contains column name)
        elif col_clean in kw_clean:
            score += 2

    return score


def detect_columns(df, column_defs):
    """
    Auto-detect column mapping for a DataFrame.

    Args:
        df: pandas DataFrame
        column_defs: OrderedDict of {field_key: {keywords, required, label, hint, relaxes?}}

    Returns:
        mapping: {field_key: column_name}
        confidence: {field_key: 'high'|'medium'|'low'|'none'}
        details: {field_key: {column, score, confidence, alternatives}}
        unmatched_required: [field_key, ...]
    """
    cols = list(df.columns)
    mapping = {}
    confidence = {}
    details = {}

    # Score every column against every field
    field_scores = {}
    for field_key, field_def in column_defs.items():
        scores = []
        for col in cols:
            s = score_column(col, field_def['keywords'])
            if s > 0:
                scores.append({'column': col, 'score': s})
        scores.sort(key=lambda x: x['score'], reverse=True)
        field_scores[field_key] = scores

    # Greedy assignment: each field gets highest-scoring unassigned column
    assigned_cols = set()

    for field_key, field_def in column_defs.items():
        scores = field_scores[field_key]
        available = [s for s in scores if s['column'] not in assigned_cols]

        if available and available[0]['score'] > 0:
            best = available[0]
            mapping[field_key] = best['column']
            assigned_cols.add(best['column'])

            if best['score'] >= 10:
                conf = 'high'
            elif best['score'] >= 5:
                conf = 'medium'
            else:
                conf = 'low'

            # Downgrade if a higher-scoring column was taken by another field
            if scores and scores[0]['column'] != best['column']:
                conf = 'medium'

            confidence[field_key] = conf
            details[field_key] = {
                'column': best['column'],
                'score': best['score'],
                'confidence': conf,
                'alternatives': [
                    {'column': s['column'], 'score': s['score']}
                    for s in scores[:5] if s['column'] != best['column']
                ]
            }
        else:
            mapping[field_key] = None
            confidence[field_key] = 'none'
            details[field_key] = {
                'column': None,
                'score': 0,
                'confidence': 'none',
                'alternatives': [{'column': s['column'], 'score': s['score']} for s in scores[:5]]
            }

    # Check required fields, respecting relaxation rules
    # Any field with 'relaxes' that IS matched makes its relaxed targets optional
    relaxed_fields = set()
    for fk, fd in column_defs.items():
        if confidence.get(fk, 'none') != 'none' and 'relaxes' in fd:
            relaxed_fields.update(fd['relaxes'])

    unmatched_required = []
    for fk, fd in column_defs.items():
        if not fd['required'] or confidence[fk] != 'none':
            continue
        if fk in relaxed_fields:
            continue
        unmatched_required.append(fk)

    return mapping, confidence, details, unmatched_required
