/**
 * 浏览器端导出工具
 *
 * 支持格式：HTML / CSV / Excel (.xlsx)
 * 下载后自动清除 IndexedDB 缓存
 */

// ---- 公开 API ----

/**
 * 导出报告并触发下载
 * @param {string} format - 'html' | 'csv' | 'excel'
 * @param {Object} report - 从 IndexedDB 加载的报告数据
 * @returns {Promise<void>}
 */
async function exportReport(format, report) {
    if (!report) {
        alert('没有可导出的报告数据');
        return;
    }

    const { DATA, detailRows, reportType, fileNames } = report;
    const safeName = sanitizeFilename(fileNames ? fileNames.join('_') : 'report');
    const dateStr = formatDate(new Date());

    let blob, filename, mimeType;

    switch (format) {
        case 'html':
            blob = new Blob([buildHTML(DATA, detailRows, reportType, fileNames)], { type: 'text/html;charset=utf-8' });
            filename = `${safeName}_${dateStr}.html`;
            mimeType = 'text/html';
            break;
        case 'csv':
            blob = buildCSV(detailRows, reportType);
            filename = `${safeName}_${dateStr}.csv`;
            mimeType = 'text/csv';
            break;
        case 'excel':
            blob = await buildExcel(DATA, detailRows, reportType);
            filename = `${safeName}_${dateStr}.xlsx`;
            mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            break;
        default:
            alert('不支持的导出格式');
            return;
    }

    // 触发下载
    triggerDownload(blob, filename);

    // 下载后自动清除缓存
    await clearReport();

    // 提示用户
    showDownloadToast(format, filename);
}

// ---- HTML 导出（原样导出页面 DOM）----

function buildHTML(DATA, rows, reportType, fileNames) {
    // Clone the current page, remove interactive elements, export full HTML
    var clone = document.documentElement.cloneNode(true);

    // Remove topbar buttons, modals, overlays
    var toRemove = clone.querySelectorAll('.topbar .actions, .mapping-modal, .load-overlay, .loading-bar-wrap, .topbar button, .topbar a[href]');
    toRemove.forEach(function(el){ el.parentNode.removeChild(el); });

    // Remove export/save/clear buttons in dashboard
    var btns = clone.querySelectorAll('a[onclick], button[onclick]');
    btns.forEach(function(el){
        if (el.textContent.includes('导出') || el.textContent.includes('保存') || el.textContent.includes('清除') || el.textContent.includes('返回')) {
            el.parentNode.removeChild(el);
        }
    });

    // Remove all script tags (charts rendered as canvas/images already)
    var scripts = clone.querySelectorAll('script');
    scripts.forEach(function(s){ s.parentNode.removeChild(s); });

    // Add export timestamp
    var title = reportType === 'sales' ? '📈 销售分析报告' : '📊 费用分析报告';
    var info = document.createElement('div');
    info.style.cssText = 'text-align:center;color:#a0a8c0;font-size:11px;padding:8px;border-bottom:1px solid #1e1e40;margin-bottom:12px';
    info.textContent = title + ' | ' + (fileNames||['-']).join(', ') + ' | 导出: ' + new Date().toLocaleString('zh-CN');
    var main = clone.querySelector('.main');
    if (main) main.insertBefore(info, main.firstChild);

    // Serialize ECharts to base64 images (to keep charts in export)
    var chartDivs = clone.querySelectorAll('.chart-box, .chart-box-sm');
    chartDivs.forEach(function(div){
        var instance = null;
        // Find echarts instance for this div
        if (typeof echarts !== 'undefined') {
            instance = echarts.getInstanceByDom(document.getElementById(div.id));
        }
        if (instance) {
            var img = document.createElement('img');
            img.src = instance.getDataURL({type:'png',pixelRatio:2,backgroundColor:'#16162e'});
            img.style.width = '100%';
            img.style.height = div.style.height || '380px';
            img.style.objectFit = 'contain';
            div.parentNode.replaceChild(img, div);
        }
    });

    return '<!DOCTYPE html>\n' + clone.outerHTML;
}

// ---- CSV 导出 ----

function buildCSV(rows, reportType) {
    if (!rows || rows.length === 0) return new Blob([''], { type: 'text/csv' });

    const keys = Object.keys(rows[0]);
    const lines = [];

    // BOM for Excel UTF-8 compatibility
    lines.push('﻿' + keys.join(','));

    for (const row of rows) {
        const vals = keys.map(k => {
            const v = row[k];
            if (v == null) return '';
            const s = String(v);
            // Escape commas and quotes
            if (s.includes(',') || s.includes('"') || s.includes('\n')) {
                return '"' + s.replace(/"/g, '""') + '"';
            }
            return s;
        });
        lines.push(vals.join(','));
    }

    return new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
}

// ---- Excel 导出 ----

async function buildExcel(DATA, rows, reportType) {
    // Use SheetJS to generate .xlsx
    if (typeof XLSX === 'undefined') {
        throw new Error('SheetJS 未加载，无法导出 Excel');
    }

    const wb = XLSX.utils.book_new();

    // Sheet 1: 明细数据
    const ws1 = XLSX.utils.json_to_sheet(rows.slice(0, 10000)); // Max 10k rows
    XLSX.utils.book_append_sheet(wb, ws1, '明细数据');

    // Sheet 2: KPI 汇总
    const kpiRows = buildExcelKPIRows(DATA, reportType);
    const ws2 = XLSX.utils.aoa_to_sheet(kpiRows);
    XLSX.utils.book_append_sheet(wb, ws2, 'KPI汇总');

    // Set column widths
    ws1['!cols'] = Object.keys(rows[0] || {}).map(() => ({ wch: 15 }));
    ws2['!cols'] = [{ wch: 22 }, { wch: 28 }];

    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function buildExcelKPIRows(DATA, reportType) {
    const rows = [['指标', '数值']];
    const kpi = DATA.kpi || {};

    if (reportType === 'sales') {
        rows.push(['当期收入（万元）', ((kpi.revenue || 0) / 10000).toFixed(1)]);
        rows.push(['毛利率', `${(kpi.gp_margin || 0).toFixed(1)}%`]);
        rows.push(['成交客户数', kpi.customers || 0]);
        rows.push(['CAGR', `${(DATA.cagr || 0).toFixed(1)}%`]);
        rows.push(['数据年份', String(DATA.years || [])]);
    } else {
        const total = kpi.total || {};
        rows.push(['当期总费用（万元）', ((total.curr || 0) / 10000).toFixed(1)]);
        rows.push(['固定费用占比', `${(DATA.fixedPct || 0).toFixed(0)}%`]);
        rows.push(['CAGR', `${(DATA.cagr || 0).toFixed(1)}%`]);
        rows.push(['部门数', (DATA.depts || []).length]);
        rows.push(['科目数', (DATA.cats || []).length]);
    }

    return rows;
}

// ---- 工具函数 ----

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sanitizeFilename(name) {
    return name.replace(/[^\w一-鿿\-.]/g, '_').replace(/_+/g, '_').substring(0, 100);
}

function formatDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}`;
}

function showDownloadToast(format, filename) {
    const names = { html: 'HTML', csv: 'CSV', excel: 'Excel' };
    // 简单提示
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a1a3a;color:#4caf84;padding:14px 28px;border-radius:10px;font-size:14px;z-index:9999;border:1px solid #4caf8440;box-shadow:0 8px 32px rgba(0,0,0,0.5)';
    toast.textContent = `✅ ${names[format] || ''} 报告已下载 | 浏览器缓存已自动清除`;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.5s';
        setTimeout(() => document.body.removeChild(toast), 500);
    }, 3000);
}
