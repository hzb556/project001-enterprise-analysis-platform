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
    // xlsx: use SheetJS
    var data = await file.arrayBuffer();
    var wb = XLSX.read(data, { type: 'array' });
    var best = wb.SheetNames[0]; var bestR = 0;
    wb.SheetNames.forEach(function(n){ var rows = XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1}); if(rows.length>bestR){bestR=rows.length;best=n;} });
    var rows = XLSX.utils.sheet_to_json(wb.Sheets[best]);
    return { headers: rows.length?Object.keys(rows[0]):[], sheetName: best, rowCount: rows.length };
}

async function readExcelDataFast(file, mapping, progressCb) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'xls') return _readCalamineFast(file, mapping, progressCb);
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
        var best = wb.SheetNames[0], bestR = 0;
        wb.SheetNames.forEach(function(n){ var rows=XLSX.utils.sheet_to_json(wb.Sheets[n],{header:1}); if(rows.length>bestR){bestR=rows.length;best=n;} });
        var rows = XLSX.utils.sheet_to_json(wb.Sheets[best]);
        if(!rows.length) return [];
        var headers = Object.keys(rows[0]);
        var colIdx = {}; // fieldKey -> headerName
        for(var fk in mapping){ if(mapping[fk]){ colIdx[fk]=mapping[fk]; } }

        var cleaned=[], total=rows.length, BATCH=50000;
        for(var i=0; i<rows.length; i++){
            var raw=rows[i], r={};
            for(var fk in colIdx){ r[fk]=raw[colIdx[fk]]; }
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
            var cleaned=[],total=allRows.length-1,BATCH=20000;
            var loop=function(i){
                if(i>=allRows.length)return Promise.resolve(cleaned);
                var rr=allRows[i],r={};
                for(var fk in colIdx){r[fk]=colIdx[fk]<rr.length?cellValueToAny(rr[colIdx[fk]]):null;}
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
                if(i%BATCH===0){
                    if(progressCb)progressCb(Math.round(i/total*100),cleaned.length,total);
                    return new Promise(function(resolve){setTimeout(function(){resolve(loop(i+1));},0);});
                }
                return loop(i+1);
            };
            return loop(1);
        });
    });
}
