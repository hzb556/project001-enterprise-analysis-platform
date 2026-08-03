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
 * 保存报告数据到 IndexedDB（等待事务完全提交后才返回）
 */
async function saveReport(data) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put({ ...data, timestamp: Date.now() }, REPORT_KEY);

        // 等待事务完全提交（而非仅 put 成功），确保数据落盘
        tx.oncomplete = () => {
            db.close();
            console.log('[Storage] 保存完成, 事务已提交');
            resolve();
        };
        tx.onerror = () => {
            db.close();
            console.error('[Storage] 保存失败:', tx.error);
            reject(tx.error);
        };
        tx.onabort = () => {
            db.close();
            reject(new Error('事务被中止'));
        };
    });
}

/**
 * 读取当前缓存的报告
 */
async function loadReport() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(REPORT_KEY);

        request.onsuccess = () => {
            const result = request.result || null;
            db.close();
            if (result) {
                console.log('[Storage] 加载完成:', (result.detailRows||[]).length, '行');
            } else {
                console.log('[Storage] 无缓存数据');
            }
            resolve(result);
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
        store.delete(REPORT_KEY);
        tx.oncomplete = () => {
            db.close();
            console.log('[Storage] 缓存已清除');
            resolve();
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error);
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
        age: Math.round((Date.now() - report.timestamp) / 1000),
    };
}
