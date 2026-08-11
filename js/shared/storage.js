/**
 * IndexedDB 存储封装
 */
const DB_NAME = 'ai_factory_reports';
const DB_VERSION = 1;
const STORE_NAME = 'reports';
const REPORT_KEY = 'current_report';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            if (!e.target.result.objectStoreNames.contains(STORE_NAME)) {
                e.target.result.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

async function saveReport(data) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const record = { ...data, timestamp: Date.now() };
        const request = store.put(record, REPORT_KEY);
        request.onsuccess = () => { db.close(); resolve(); };
        request.onerror = () => { db.close(); reject(request.error); };
    });
}

async function loadReport() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(REPORT_KEY);
        request.onsuccess = () => {
            db.close();
            const result = request.result || null;
            if (result) console.log('[Storage] 加载:', (result.detailRows||[]).length, '行');
            else console.log('[Storage] 无缓存');
            resolve(result);
        };
        request.onerror = () => { db.close(); reject(request.error); };
    });
}

async function hasReport() {
    const r = await loadReport();
    return r !== null;
}

async function clearReport() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(REPORT_KEY);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}

async function getCacheInfo() {
    const r = await loadReport();
    if (!r) return null;
    return {
        reportType: r.reportType,
        fileNames: r.fileNames,
        rowCount: (r.detailRows||[]).length,
        timestamp: r.timestamp,
        age: Math.round((Date.now() - r.timestamp) / 1000),
    };
}

// ---- 列映射记忆（localStorage）----
const MAPPING_PREFIX = 'col_map_';

function _hashHeaders(headers) {
    var s = headers.slice().sort().join('|');
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
    return Math.abs(h).toString(36);
}

function saveMapping(moduleType, headers, mapping) {
    var key = MAPPING_PREFIX + moduleType + '_' + _hashHeaders(headers);
    var entry = { headers: headers, mapping: mapping, savedAt: Date.now() };
    localStorage.setItem(key, JSON.stringify(entry));
    // Keep only last 10 entries
    var keys = []; for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.startsWith(MAPPING_PREFIX)) keys.push(k); }
    if (keys.length > 10) { keys.sort(); for (var j = 0; j < keys.length - 10; j++) localStorage.removeItem(keys[j]); }
}

function loadMapping(moduleType, headers) {
    var key = MAPPING_PREFIX + moduleType + '_' + _hashHeaders(headers);
    var raw = localStorage.getItem(key);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch(e) { return null; }
}

function listMappings(moduleType) {
    var results = [];
    for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.startsWith(MAPPING_PREFIX + moduleType)) {
            try {
                var entry = JSON.parse(localStorage.getItem(k));
                entry._key = k;
                results.push(entry);
            } catch(e) {}
        }
    }
    results.sort(function(a,b){ return b.savedAt - a.savedAt; });
    return results;
}

function deleteMapping(key) {
    localStorage.removeItem(key);
}
