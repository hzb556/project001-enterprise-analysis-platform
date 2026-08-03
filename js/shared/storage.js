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
