/**
 * 统一 Excel 读取层
 *
 * 策略：
 *   .xlsx → SheetJS（C 级批量转换，最快）
 *   .xls  → calamine WASM（SheetJS 免费版不支持）
 */

let _calamineMod = null;
let _calamineInitPromise = null;

async function initCalamine() {
    if (_calamineMod) return _calamineMod;
    if (_calamineInitPromise) return _calamineInitPromise;
    _calamineInitPromise = (async () => {
        try {
            const mod = await import('/js/vendor/calamine_js.js');
            const wasmUrl = new URL('js/vendor/calamine_js_bg.wasm', window.location.href).href;
            await mod.default(wasmUrl);
            _calamineMod = mod;
            console.log('[Excel] calamine WASM 就绪');
            return mod;
        } catch (e) {
            console.warn('[Excel] calamine 初始化失败:', e.message);
            return null;
        }
    })();
    return _calamineInitPromise;
}

function cellValueToAny(cv) {
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
        return cv.to_string_value() || cv.to_float_value() || (cv.to_int_value() != null ? Number(cv.to_int_value()) : null);
    } catch(e) { return null; }
}

function cellValueToString(cv) {
    if (cv == null) return '';
    try {
        if (typeof cv === 'string' || typeof cv === 'number' || typeof cv === 'boolean') return String(cv);
        if (cv.is_empty) return '';
        if (cv.is_string) return cv.to_string_value() || '';
        if (cv.is_datetime || cv.is_float) { var f = cv.to_float_value(); return f != null ? String(f) : ''; }
        return cv.to_string_value() || '';
    } catch(e) { return ''; }
}

// ---- Public API ----

async function readExcelFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'xls') return readWithCalamine(file);
    if (ext === 'xlsx') {
        try { return await readWithSheetJS(file); }
        catch(e) { console.warn('[Excel] SheetJS failed, fallback calamine'); return readWithCalamine(file); }
    }
    throw new Error('Unsupported format: .' + ext);
}

async function readExcelHeaders(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'xls') {
        var r = await readWithCalamine(file);
        return { headers: r.headers, sheetName: r.sheetName, rowCount: r.rows.length };
    }
    // xlsx: read ONLY headers, not all data
    var data = await file.arrayBuffer();
    var wb = XLSX.read(data, { type: 'array', sheetRows: 1 }); // sheetRows: 1 = only first row
    var best = wb.SheetNames[0]; var bestR = 0;
    // Check row count without loading all data
    wb.SheetNames.forEach(function(n){
        var ref = wb.Sheets[n]['!ref'];
        if (ref) {
            var range = XLSX.utils.decode_range(ref);
            var rows = range.e.r - range.s.r + 1;
            if (rows > bestR) { bestR = rows; best = n; }
        }
    });
    var headerSheet = XLSX.utils.sheet_to_json(wb.Sheets[best], { header: 1 });
    var headers = headerSheet.length > 0 ? headerSheet[0].map(function(c){ return String(c||''); }) : [];
    return { headers: headers, sheetName: best, rowCount: bestR };
}

async function readExcelDataFast(file, mapping, progressCb) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'xls') return _readCalamineFast(file, mapping, progressCb);
    // >50MB: reject with clear message (server-side processing coming later)
    var limit = (APP_CONFIG.largeFileThresholdMB || APP_CONFIG.maxFileSizeMB || 50);
    if (file.size > limit * 1024 * 1024) {
        throw new Error('文件过大（'+(file.size/1024/1024).toFixed(0)+'MB）。浏览器处理上限为'+limit+'MB。\n请拆分文件后重试，或等待服务端处理功能上线。');
    }
    return _readSheetJSFast(file, mapping, progressCb);
}

// ---- Internal ----

async function readWithSheetJS(file) {
    var data = await file.arrayBuffer();
    var wb = XLSX.read(data, { type: 'array' });
    var best = wb.SheetNames[0]; var bestR = 0;
    wb.SheetNames.forEach(function(n){ var rows = XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1}); if(rows.length>bestR){bestR=rows.length;best=n;} });
    var rows = XLSX.utils.sheet_to_json(wb.Sheets[best]);
    return { headers: rows.length?Object.keys(rows[0]):[], rows: rows, sheetName: best };
}

async function readWithCalamine(file) {
    var mod = await initCalamine();
    if (!mod) throw new Error('calamine not ready');
    var bytes = new Uint8Array(await file.arrayBuffer());
    var wb = mod.Workbook.from_bytes(bytes);
    var names = wb.sheet_names();
    var best = null, bestR = 0;
    for (var i=0; i<names.length; i++){ var s=wb.get_sheet_by_index(i); if(s&&s.rows&&s.rows.length>bestR){bestR=s.rows.length;best=s;} }
    if(!best||best.rows.length===0) throw new Error('Empty file');
    var rawRows = best.rows||[];
    var headers = (rawRows[0]||[]).map(function(cv){return cellValueToString(cv);});
    var rows = [];
    for (var i=1; i<rawRows.length; i++){
        var row={}, rr=rawRows[i];
        headers.forEach(function(h,idx){ row[h] = idx<rr.length?cellValueToAny(rr[idx]):null; });
        rows.push(row);
    }
    return { headers, rows, sheetName: best.name||'Sheet1' };
}

function _readSheetJSFast(file, mapping, progressCb) {
    return file.arrayBuffer().then(function(data){
        var wb = XLSX.read(data, {type:'array'});
        // Find best sheet
        var best = wb.SheetNames[0], bestR = 0;
        wb.SheetNames.forEach(function(n){ var rows=XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1}); if(rows.length>bestR){bestR=rows.length;best=n;} });
        // Read as array-of-arrays (header:1) — no object creation overhead
        var rawRows = XLSX.utils.sheet_to_json(wb.Sheets[best], {header:1});
        if(rawRows.length < 2) return [];
        var headers = rawRows[0];
        // Map fieldKey -> column index (only the columns we actually need)
        var colIdx = {}; // fieldKey -> columnIndex
        for(var fk in mapping){ if(mapping[fk]){ for(var h=0; h<headers.length; h++){ if(String(headers[h])===mapping[fk]){ colIdx[fk]=h; break; } } } }

        var cleaned=[], total=rawRows.length-1, BATCH=50000;
        for(var i=1; i<rawRows.length; i++){
            var raw=rawRows[i], r={};
            // Only pick needed columns by index — skip the rest
            for(var fk in colIdx){ r[fk] = colIdx[fk] < raw.length ? raw[colIdx[fk]] : null; }
            if(r.date!=null&&(!r.year||!r.month)){
                var dVal=r.date;
                if(typeof dVal==='string'){var n=parseFloat(dVal);if(!isNaN(n)&&n>30000&&n<100000)dVal=n;}
                if(typeof dVal==='number'&&dVal>30000&&dVal<100000){var d=new Date((dVal-25569)*86400*1000);if(!r.year)r.year=d.getUTCFullYear();if(!r.month)r.month=d.getUTCMonth()+1;}
            }
            var year=parseInt(r.year),month=parseInt(r.month);
            if(isNaN(year)||year<2000||year>2100||isNaN(month)||month<1||month>12)continue;
            r.year=year;r.month=month;r.amount=parseFloat(r.amount)||0;
            cleaned.push(r);
            if(i%BATCH===0&&progressCb)progressCb(Math.round(i/total*100),cleaned.length,total);
        }
        return cleaned;
    });
}

function _readCalamineFast(file, mapping, progressCb) {
    return initCalamine().then(function(mod){
        if(!mod)throw new Error('calamine not ready');
        return file.arrayBuffer().then(function(buf){
            var wb=mod.Workbook.from_bytes(new Uint8Array(buf));
            var names=wb.sheet_names(),best=null,bestR=0;
            for(var i=0;i<names.length;i++){var s=wb.get_sheet_by_index(i);if(s&&s.rows&&s.rows.length>bestR){bestR=s.rows.length;best=s;}}
            if(!best||best.rows.length<2)return[];
            var allRows=best.rows;
            var headers=(allRows[0]||[]).map(function(cv){return cellValueToString(cv);});
            var colIdx={};
            for(var fk in mapping){if(mapping[fk]){var idx=headers.indexOf(mapping[fk]);if(idx>=0)colIdx[fk]=idx;}}
            var cleaned=[],total=allRows.length-1,BATCH=5000;

            // Iterative with yield — no recursion, no stack overflow
            return new Promise(function(resolve, reject){
                var i=1;
                function processChunk(){
                    try {
                        var end=Math.min(i+BATCH, allRows.length);
                        for(;i<end;i++){
                            var rr=allRows[i],r={};
                            for(var fk in colIdx){r[fk]=colIdx[fk]<rr.length?cellValueToAny(rr[colIdx[fk]]):null;}
                            if(r.cost==null)r.cost=0; if(r.quantity==null)r.quantity=0; if(r.unit_price==null)r.unit_price=0;
                            if(!r.salesperson)r.salesperson=''; if(!r.brand)r.brand='未知'; if(!r.region)r.region='未知';
                            if(!r.channel)r.channel='未知'; if(!r.department)r.department='未知'; if(!r.category)r.category='未分类';
                            if(r.date!=null&&(!r.year||!r.month)){
                                var dVal=r.date;
                                if(typeof dVal==='string'){var n=parseFloat(dVal);if(!isNaN(n)&&n>30000&&n<100000)dVal=n;}
                                if(typeof dVal==='number'&&dVal>30000&&dVal<100000){var d=new Date((dVal-25569)*86400*1000);if(!r.year)r.year=d.getUTCFullYear();if(!r.month)r.month=d.getUTCMonth()+1;}
                            }
                            var year=parseInt(r.year),month=parseInt(r.month);
                            if(!isNaN(year)&&year>=2000&&year<=2100&&!isNaN(month)&&month>=1&&month<=12){
                                r.year=year;r.month=month;r.amount=parseFloat(r.amount)||0;
                                cleaned.push(r);
                            }
                            // Cap at 200K rows to prevent analysis OOM
                            if(cleaned.length>=200000){i=allRows.length;break;}
                        }
                        if(progressCb)progressCb(Math.round(i/total*100),cleaned.length,total);
                        if(i>=allRows.length){resolve(cleaned);return;}
                        setTimeout(processChunk,10);
                    } catch(e) { reject(e); }
                }
                processChunk();
            });
        });
    });
}
