/**
 * IndexedDB 存储封装
 *
 * 用途：缓存分析结果，用户下载报告后自动清除
 *
 * 数据库结构：
 *   DB: ai_factory_reports
 *   Store: reports (key: "current_report")
 */

const DB_NAME = 'ai_factory_reports';
const DB_VERSION = 1;
const STORE_NAME = 'reports';
const REPORT_KEY = 'current_report';

// ---- 数据库操作 ----

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = (e) => resolve(e.target.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

// ---- 公开 API ----

/**
 * 保存报告数据到 IndexedDB
 * @param {Object} data - { DATA, detailRows, reportType, fileNames }
 */
async function saveReport(data) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const record = {
            ...data,
            timestamp: Date.now(),
        };
        const request = store.put(record, REPORT_KEY);
        request.onsuccess = () => {
            db.close();
            resolve();
        };
        request.onerror = () => {
            db.close();
            reject(request.error);
        };
    });
}

/**
 * 读取当前缓存的报告
 * @returns {Object|null} 报告数据，无缓存时返回 null
 */
async function loadReport() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(REPORT_KEY);
        request.onsuccess = () => {
            db.close();
            resolve(request.result || null);
        };
        request.onerror = () => {
            db.close();
            reject(request.error);
        };
    });
}

/**
 * 检查是否有缓存的报告
 */
async function hasReport() {
    const report = await loadReport();
    return report !== null && report !== undefined;
}

/**
 * 删除缓存的报告（下载时调用）
 */
async function clearReport() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(REPORT_KEY);
        request.onsuccess = () => {
            db.close();
            console.log('[Storage] 报告缓存已清除');
            resolve();
        };
        request.onerror = () => {
            db.close();
            reject(request.error);
        };
    });
}

/**
 * 获取缓存信息（用于 UI 显示）
 */
async function getCacheInfo() {
    const report = await loadReport();
    if (!report) return null;
    return {
        reportType: report.reportType,
        fileNames: report.fileNames,
        rowCount: report.detailRows ? report.detailRows.length : 0,
        timestamp: report.timestamp,
        age: Math.round((Date.now() - report.timestamp) / 1000), // 秒
    };
}
