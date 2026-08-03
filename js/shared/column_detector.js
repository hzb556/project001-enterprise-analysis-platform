/**
 * Generic column-to-field matching engine (browser version).
 * Uses keyword scoring + greedy assignment to map Excel column names.
 * All functions are global.
 */

function scoreColumn(colName, keywords) {
  let score = 0;
  const cl = cleanStr(colName);
  keywords.forEach(kw => {
    const kwl = cleanStr(kw);
    if (cl === kwl) score += 10;
    else if (cl.includes(kwl)) score += 5;
    else if (cl.startsWith(kwl)) score += 4;
    else if (kwl.includes(cl)) score += 2;
  });
  return score;
}

/**
 * Auto-detect column mapping.
 * @param {string[]} headers - Column header names from SheetJS
 * @param {object} columnDefs - Field definitions {fieldKey: {keywords, required, label, hint, relaxes?}}
 * @returns {{mapping, confidence, details, unmatched}}
 */
function detectColumnsGeneric(headers, columnDefs) {
  const fieldScores = {};
  for (const [fk, def] of Object.entries(columnDefs)) {
    const scores = headers
      .map(h => ({ column: h, score: scoreColumn(h, def.keywords) }))
      .filter(s => s.score > 0)
      .sort((a,b) => b.score - a.score);
    fieldScores[fk] = scores;
  }

  const mapping = {};
  const confidence = {};
  const details = {};
  const assigned = new Set();

  for (const [fk, def] of Object.entries(columnDefs)) {
    const scores = fieldScores[fk];
    const available = scores.filter(s => !assigned.has(s.column));

    if (available.length > 0 && available[0].score > 0) {
      const best = available[0];
      mapping[fk] = best.column;
      assigned.add(best.column);

      let conf = best.score >= 10 ? 'high' : (best.score >= 5 ? 'medium' : 'low');
      if (scores.length > 0 && scores[0].column !== best.column) conf = 'medium';
      confidence[fk] = conf;

      details[fk] = {
        column: best.column, score: best.score, confidence: conf,
        alternatives: scores.filter(s => s.column !== best.column).slice(0, 5)
          .map(s => ({column: s.column, score: s.score}))
      };
    } else {
      mapping[fk] = null;
      confidence[fk] = 'none';
      details[fk] = {
        column: null, score: 0, confidence: 'none',
        alternatives: scores.slice(0,5).map(s => ({column: s.column, score: s.score}))
      };
    }
  }

  // Relaxation logic via 'relaxes' field definitions
  const relaxedFields = new Set();
  for (const [fk, def] of Object.entries(columnDefs)) {
    if (confidence[fk] !== 'none' && def.relaxes) {
      def.relaxes.forEach(rf => relaxedFields.add(rf));
    }
  }

  const unmatched = Object.entries(columnDefs)
    .filter(([fk, d]) => {
      if (!d.required || confidence[fk] !== 'none') return false;
      if (relaxedFields.has(fk)) return false;
      return true;
    })
    .map(([fk]) => fk);

  return { mapping, confidence, details, unmatched };
}

/**
 * Expense-specific wrapper (backward compat).
 * Falls back to global COLUMN_DEFS.
 */
function detectColumns(headers) {
  if (typeof COLUMN_DEFS === 'undefined') {
    throw new Error('COLUMN_DEFS not loaded — include expense/column_defs.js before calling detectColumns()');
  }
  return detectColumnsGeneric(headers, COLUMN_DEFS);
}
