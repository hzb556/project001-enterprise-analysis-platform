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
            blob = buildHTML(DATA, detailRows, reportType, fileNames);
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

// ---- HTML 导出 ----

function buildHTML(DATA, rows, reportType, fileNames) {
    const diagHTML = DATA.diagHTML || '';
    const title = reportType === 'sales' ? '销售分析报告' : '费用分析报告';
    const kpiSummary = buildHTMLKPISummary(DATA, reportType);

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — ${fileNames ? fileNames.join(', ') : ''}</title>
<style>
body{font-family:"Microsoft YaHei","PingFang SC",sans-serif;max-width:1200px;margin:0 auto;padding:20px;background:#0b0b18;color:#e0e0e0;line-height:1.7}
h1{color:#5b9bd5;border-bottom:2px solid #5b9bd5;padding-bottom:10px}
h2{color:#a0a8c0;margin-top:30px}
h3{color:#5b9bd5;margin-top:24px}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin:20px 0}
.kpi-card{background:#1a1a3a;border-radius:10px;padding:16px}
.kpi-card .label{color:#a0a8c0;font-size:13px}
.kpi-card .value{font-size:24px;font-weight:700;color:#fff}
.kpi-card .sub{font-size:12px;color:#a0a8c0;margin-top:4px}
table{width:100%;border-collapse:collapse;margin:12px 0;font-size:13px}
th{background:#1e1e40;padding:8px 12px;text-align:left;color:#a0a8c0}
td{padding:6px 12px;border-bottom:1px solid #1a1a3a}
.up{color:#ff5252}.dn{color:#4caf84}
ul{padding-left:20px}
li{margin:6px 0;color:#a0a8c0}
.footer{margin-top:40px;padding-top:16px;border-top:1px solid #1a1a3a;font-size:11px;color:#555}
</style>
</head>
<body>
<h1>${title}</h1>
<p>数据文件：${fileNames ? fileNames.join(', ') : '-'} | 生成时间：${new Date().toLocaleString('zh-CN')}</p>

<h2>📊 KPI 汇总</h2>
<div class="kpi-grid">${kpiSummary}</div>

<h2>📋 诊断结论</h2>
<div>${diagHTML}</div>

<h2>📋 明细数据（前 500 行）</h2>
${buildHTMLTable(rows.slice(0, 500), reportType)}

<p class="footer">由 AI_FACTORY 企业运营分析平台生成 | 数据仅存储在您的浏览器中</p>
</body>
</html>`;
}

function buildHTMLKPISummary(DATA, reportType) {
    const kpi = DATA.kpi || {};
    const cards = [];

    if (reportType === 'sales') {
        cards.push(
            { l: '当期收入', v: `${((kpi.revenue || 0) / 10000).toFixed(0)} 万` },
            { l: '毛利率', v: `${(kpi.gp_margin || 0).toFixed(1)}%` },
            { l: '成交客户', v: kpi.customers || 0 },
            { l: 'CAGR', v: `${(DATA.cagr || 0).toFixed(1)}%` },
        );
    } else {
        const total = (kpi.total || {});
        cards.push(
            { l: '当期总费用', v: `${((total.curr || 0) / 10000).toFixed(0)} 万` },
            { l: '固定费用占比', v: `${(DATA.fixedPct || 0).toFixed(0)}%` },
            { l: 'CAGR', v: `${(DATA.cagr || 0).toFixed(1)}%` },
            { l: '部门数', v: (DATA.depts || []).length },
        );
    }

    return cards.map(c =>
        `<div class="kpi-card"><div class="label">${c.l}</div><div class="value">${c.v}</div></div>`
    ).join('');
}

function buildHTMLTable(rows, reportType) {
    if (!rows || rows.length === 0) return '<p>无数据</p>';

    const sample = rows[0];
    const keys = Object.keys(sample);
    const th = keys.map(k => `<th>${k}</th>`).join('');
    const trs = rows.map(r =>
        `<tr>${keys.map(k => `<td>${formatCell(r[k])}</td>`).join('')}</tr>`
    ).join('');

    return `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
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

function formatCell(val) {
    if (val == null) return '';
    if (typeof val === 'number') {
        return Number.isInteger(val) ? String(val) : val.toFixed(2);
    }
    return String(val);
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
