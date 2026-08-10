/**
 * Excel 读取 Web Worker — 在后台线程处理，不阻塞 UI
 */
let _mod = null;
let _Calamine = null;

async function init() {
    if (_mod) return _mod;
    var calMod = await import('../vendor/calamine_js.js');
    _Calamine = calMod;
    _mod = await calMod.default('js/vendor/calamine_js_bg.wasm');
    return _mod;
}

function cvToAny(cv) {
    if (cv == null) return null;
    try {
        if (typeof cv === 'string' || typeof cv === 'number' || typeof cv === 'boolean') return cv;
        if (cv.is_empty) return null;
        if (cv.is_datetime) {
            var f = cv.to_float_value(); if (f != null) return f;
            var s = cv.to_string_value(); if (s != null) { var n = parseFloat(s); if (!isNaN(n) && n > 30000) return n; return s; }
            return null;
        }
        if (cv.is_float) return cv.to_float_value();
        if (cv.is_int) { var v = cv.to_int_value(); return v != null ? Number(v) : null; }
        if (cv.is_bool) return cv.to_bool_value();
        if (cv.is_string) return cv.to_string_value();
        return cv.to_string_value() || cv.to_float_value();
    } catch(e) { return null; }
}

function cvToString(cv) {
    if (cv == null) return '';
    try {
        if (typeof cv === 'string' || typeof cv === 'number' || typeof cv === 'boolean') return String(cv);
        if (cv.is_empty) return '';
        if (cv.is_string) return cv.to_string_value() || '';
        if (cv.is_datetime || cv.is_float) { var f = cv.to_float_value(); return f != null ? String(f) : ''; }
        return cv.to_string_value() || '';
    } catch(e) { return ''; }
}

self.onmessage = async function(e) {
    var { fileData, mapping, fileName } = e.data;
    try {
        var mod = await init();
        var workbook = _Calamine.Workbook.from_bytes(new Uint8Array(fileData));

        // Find best sheet
        var sheetNames = workbook.sheet_names();
        var bestSheet = null, bestRows = 0;
        for (var i = 0; i < sheetNames.length; i++) {
            var s = workbook.get_sheet_by_index(i);
            if (s && s.rows && s.rows.length > bestRows) { bestRows = s.rows.length; bestSheet = s; }
        }

        if (!bestSheet || bestSheet.rows.length < 2) {
            self.postMessage({ error: '文件中没有数据' });
            return;
        }

        var allRawRows = bestSheet.rows;
        var rawHeaders = allRawRows[0] || [];
        var headers = [];
        for (var h = 0; h < rawHeaders.length; h++) headers.push(cvToString(rawHeaders[h]));

        // Build column index
        var colMap = {}; // fieldKey → columnIndex
        var mapKeys = Object.keys(mapping);
        for (var k = 0; k < mapKeys.length; k++) {
            var fk = mapKeys[k];
            var col = mapping[fk];
            if (col) {
                var idx = headers.indexOf(col);
                if (idx >= 0) colMap[fk] = idx;
            }
        }

        // Batch process with progress updates
        var totalRows = allRawRows.length - 1;
        var cleaned = [];
        var BATCH = 20000;
        for (var ri = 1; ri < allRawRows.length; ri++) {
            var rawRow = allRawRows[ri];
            var r = {};
            var ck = Object.keys(colMap);
            for (var ci = 0; ci < ck.length; ci++) {
                var fk = ck[ci];
                r[fk] = colMap[fk] < rawRow.length ? cvToAny(rawRow[colMap[fk]]) : null;
            }

            // Inline validation (same as processor)
            if (r.date != null && (!r.year || !r.month)) {
                var dVal = r.date;
                if (typeof dVal === 'string') { var n = parseFloat(dVal); if (!isNaN(n) && n > 30000 && n < 100000) dVal = n; }
                if (typeof dVal === 'number' && dVal > 30000 && dVal < 100000) {
                    var d = new Date((dVal - 25569) * 86400 * 1000);
                    if (!r.year) r.year = d.getUTCFullYear();
                    if (!r.month) r.month = d.getUTCMonth() + 1;
                }
            }
            var year = parseInt(r.year), month = parseInt(r.month);
            if (isNaN(year) || year < 2000 || year > 2100 || isNaN(month) || month < 1 || month > 12) continue;
            r.year = year; r.month = month;
            r.amount = parseFloat(r.amount) || 0;
            cleaned.push(r);

            // Progress every batch
            if (ri % BATCH === 0) {
                self.postMessage({ progress: Math.round(ri / totalRows * 100), loaded: cleaned.length, total: totalRows });
            }
        }

        self.postMessage({
            done: true,
            headers: headers,
            rows: cleaned,
            sheetName: bestSheet.name || 'Sheet1',
            sheetInfo: sheetNames.map(function(n, i) { var s = workbook.get_sheet_by_index(i); return n + '(' + (s && s.rows ? s.rows.length : 0) + '行)'; }).join(', '),
        });
    } catch(err) {
        self.postMessage({ error: err.message || 'Worker 处理失败' });
    }
};
