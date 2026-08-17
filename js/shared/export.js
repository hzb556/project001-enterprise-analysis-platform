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
            blob = new Blob([await buildHTML(DATA, detailRows, reportType, fileNames)], { type: 'text/html;charset=utf-8' });
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

// ---- HTML 导出（完全自包含、可交互）----

async function buildHTML(DATA, rows, reportType, fileNames) {
    // 1. 读取当前 dashboard 的完整源码（含渲染脚本）
    var dashFile = reportType === 'sales' ? 'sales_dashboard.html' : 'expense_dashboard.html';
    var html = await fetch(dashFile).then(function(r){ return r.text(); });

    // 2. 内联所有外部 script（echarts/tabulator/tabulator-builder/storage/export）
    var scriptRe = /<script src="([^"]+)"><\/script>/g;
    var scriptMatches = [];
    var sm;
    while ((sm = scriptRe.exec(html)) !== null) { scriptMatches.push(sm); }
    for (var i = 0; i < scriptMatches.length; i++) {
        var src = scriptMatches[i][1];
        try {
            var jsContent = await fetch(src).then(function(r){ return r.text(); });
            html = html.replace(scriptMatches[i][0], '<script>\n' + jsContent + '\n</script>');
        } catch(e) {
            // 读取失败则保留原引用
        }
    }

    // 3. 内联所有外部 CSS
    var linkRe = /<link href="([^"]+)" rel="stylesheet">/g;
    var linkMatches = [];
    var lm;
    while ((lm = linkRe.exec(html)) !== null) { linkMatches.push(lm); }
    for (var j = 0; j < linkMatches.length; j++) {
        var href = linkMatches[j][1];
        try {
            var cssContent = await fetch(href).then(function(r){ return r.text(); });
            html = html.replace(linkMatches[j][0], '<style>\n' + cssContent + '\n</style>');
        } catch(e) {
            // 读取失败则保留原引用
        }
    }

    // 4. 注入报告数据（导出模式优先读内嵌数据）
    // 明细数据用数组数组紧凑格式（省字段名，减半体积），注入时解压还原
    var cols = rows.length > 0 ? Object.keys(rows[0]) : [];
    var dataArr = rows.map(function(r){ return cols.map(function(c){ return r[c]; }); });
    var compactJson = JSON.stringify({ cols: cols, data: dataArr }).replace(/</g, '\\u003c');
    var metaJson = JSON.stringify({ DATA: DATA, id: 'export', fileNames: fileNames, reportType: reportType }).replace(/</g, '\\u003c');

    var dataScript = '<script>' +
        'window.__EXPORT_DATA__ = ' + metaJson + ';' +
        '(function(){var c=' + compactJson + ';window.__EXPORT_DATA__.detailRows=c.data.map(function(r){var o={};for(var i=0;i<c.cols.length;i++)o[c.cols[i]]=r[i];return o;});})();' +
        '</script>';
    html = html.replace('</head>', dataScript + '\n</head>');

    // 5. 改造 init 数据加载：优先读内嵌数据
    html = html.replace(
        'var r = await loadReport();',
        'var r = window.__EXPORT_DATA__ || (typeof loadReport !== \'undefined\' ? await loadReport() : null);'
    );

    return html;
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
