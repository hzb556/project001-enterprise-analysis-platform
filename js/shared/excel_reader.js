/**
 * 统一 Excel 读取层
 *
 * 策略：
 *   .xls  → calamine WASM（必须，SheetJS 免费版不支持 .xls）
 *   .xlsx → calamine WASM（主力，速度快）
 *   .xlsx → SheetJS（降级，WASM 加载失败时）
 *
 * 依赖：
 *   js/vendor/calamine_js.js  +  calamine_js_bg.wasm  （calamine WASM）
 *   js/vendor/xlsx.full.min.js                          （SheetJS 降级后备）
 */

let _calamineMod = null;
let _calamineInitPromise = null;

// ---- calamine WASM 初始化 ----

async function initCalamine() {
    if (_calamineMod) return _calamineMod;
    if (_calamineInitPromise) return _calamineInitPromise;

    _calamineInitPromise = (async () => {
        try {
            // Dynamic import ES module — calamine_js.js exports { Workbook, initSync, default: init }
            // Absolute path from page root — import() in classic scripts resolves relative to page
            const mod = await import('/js/vendor/calamine_js.js');
            // Default export is the async init function (wasm-bindgen standard)
            const wasmUrl = new URL('js/vendor/calamine_js_bg.wasm', window.location.href).href;
            await mod.default(wasmUrl);
            _calamineMod = mod;
            console.log('[Excel] calamine WASM 初始化完成');
            return mod;
        } catch (e) {
            console.warn('[Excel] calamine WASM 初始化失败:', e.message);
            return null;
        }
    })();

    return _calamineInitPromise;
}

// ---- 公开 API ----

/**
 * 读取 Excel 文件，返回行列数据
 *
 * @param {File} file - 用户选择的文件
 * @returns {Promise<{headers: string[], rows: object[], sheetName: string}>}
 */
async function readExcelFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'xls') {
        return readWithCalamine(file);
    }

    if (ext === 'xlsx') {
        // 优先使用 calamine（快），降级到 SheetJS
        const calamineOk = await initCalamine();
        if (calamineOk) {
            try {
                return await readWithCalamine(file);
            } catch (e) {
                console.warn('[Excel] calamine 读取失败，降级到 SheetJS:', e.message);
                return await readWithSheetJS(file);
            }
        }
        return await readWithSheetJS(file);
    }

    throw new Error(`不支持的文件格式: .${ext}`);
}

/**
 * 批量读取多个文件并合并
 *
 * @param {File[]} files
 * @returns {Promise<{headers: string[], rows: object[], files: string[]}>}
 */
async function readExcelFiles(files) {
    if (!files || files.length === 0) {
        throw new Error('未选择文件');
    }

    const allRows = [];
    const fileNames = [];
    let firstHeaders = null;

    for (const file of files) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (!['xlsx', 'xls'].includes(ext)) {
            throw new Error(`文件 "${file.name}" 格式不支持，仅接受 .xlsx / .xls`);
        }
        // 检查文件大小
        if (file.size > APP_CONFIG.maxFileSizeMB * 1024 * 1024) {
            throw new Error(`文件 "${file.name}" 超过 ${APP_CONFIG.maxFileSizeMB}MB 限制`);
        }
    }

    for (const file of files) {
        const result = await readExcelFile(file);
        if (!firstHeaders) {
            firstHeaders = result.headers;
        }
        allRows.push(...result.rows);
        fileNames.push(file.name);
    }

    return {
        headers: firstHeaders || [],
        rows: allRows,
        fileNames,
    };
}

// ---- 内部实现 ----

/**
 * 使用 calamine WASM 读取
 */
async function readWithCalamine(file) {
    const mod = await initCalamine();
    if (!mod) {
        throw new Error('calamine WASM 未就绪');
    }

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // calaminejs API: Workbook.from_bytes()
    const workbook = mod.Workbook.from_bytes(bytes);
    // Pick the sheet with the most rows (not just index 0)
    const sheetNames = workbook.sheet_names();
    let bestSheet = null, bestRows = 0;
    for (let i = 0; i < sheetNames.length; i++) {
      const s = workbook.get_sheet_by_index(i);
      if (s && s.rows && s.rows.length > bestRows) {
        bestRows = s.rows.length;
        bestSheet = s;
      }
    }
    const sheet = bestSheet;

    if (!sheet || sheet.rows.length === 0) {
        throw new Error('文件中没有数据');
    }
    // Build sheet info for diagnostics
    var sheetInfo = sheetNames.map(function(n, i){
      var s = workbook.get_sheet_by_index(i);
      return n + '(' + (s && s.rows ? s.rows.length : 0) + '行)';
    }).join(', ');
    if (sheetNames.length > 1) {
      console.log('[Excel] 选择了数据最多的 sheet: ' + sheet.name + ' (' + sheet.rows.length + ' 行)，共 ' + sheetNames.length + ' 个 sheet: ' + sheetInfo);
    }

    // sheet.rows is an array of arrays of CellValue objects
    const rawRows = sheet.rows || [];

    // Convert first row to headers
    const headers = (rawRows[0] || []).map(cv => cellValueToString(cv));
    console.log('[Excel] Headers: ' + JSON.stringify(headers));
    const rows = [];

    for (let i = 1; i < rawRows.length; i++) {
        const row = {};
        const rawRow = rawRows[i];
        headers.forEach((header, idx) => {
            row[header] = idx < rawRow.length ? cellValueToAny(rawRow[idx]) : null;
        });
        rows.push(row);
    }

    return { headers, rows, sheetName: sheet.name || 'Sheet1', sheetInfo: sheetInfo };
}

/**
 * Convert calamine CellValue to a plain JS string (for headers)
 */
function cellValueToString(cv) {
    if (cv == null) return '';
    try {
        if (typeof cv === 'string' || typeof cv === 'number' || typeof cv === 'boolean') return String(cv);
        if (cv.is_empty) return '';
        if (cv.is_string) return cv.to_string_value() || '';
        if (cv.is_float) { const v = cv.to_float_value(); return v != null ? String(v) : ''; }
        if (cv.is_int) { const v = cv.to_int_value(); return v != null ? String(v) : ''; }
        if (cv.is_bool) { const v = cv.to_bool_value(); return v != null ? String(v) : ''; }
        // Fallback: try all conversions
        return cv.to_string_value() || String(cv.to_float_value() || cv.to_int_value() || '');
    } catch(e) {
        return '';
    }
}

/**
 * Convert calamine CellValue to the best JS type (for data rows)
 */
function cellValueToAny(cv) {
    if (cv == null) return null;
    try {
        if (typeof cv === 'string' || typeof cv === 'number' || typeof cv === 'boolean') return cv;
        if (cv.is_empty) return null;
        // DateTime: always return numeric serial number for parseDate()
        if (cv.is_datetime) {
            var f = cv.to_float_value();
            if (f != null) return f;
            var s = cv.to_string_value();
            if (s != null) { var n = parseFloat(s); if (!isNaN(n) && n > 30000) return n; return s; }
            return null;
        }
        if (cv.is_float) return cv.to_float_value();
        if (cv.is_int) { const v = cv.to_int_value(); return v != null ? Number(v) : null; }
        if (cv.is_bool) return cv.to_bool_value();
        if (cv.is_string) return cv.to_string_value();
        return cv.to_string_value() || cv.to_float_value() || (cv.to_int_value() != null ? Number(cv.to_int_value()) : null);
    } catch(e) {
        return null;
    }
}

/**
 * 使用 SheetJS 读取（降级后备）
 */
async function readWithSheetJS(file) {
    if (typeof XLSX === 'undefined') {
        throw new Error('SheetJS 未加载');
    }

    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet);
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

    return { headers, rows, sheetName };
}
