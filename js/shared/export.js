/**
 * 浏览器端导出工具
 *
 * 支持格式：HTML / CSV / Excel (.xlsx)
 * HTML 导出为完全自包含、可交互的离线报告（内嵌库 + 数据 + 脚本）。
 * 下载后自动清除 IndexedDB 缓存。
 */

// 明细行超过此数时，HTML 导出默认不包含明细（可手动勾选）
const HTML_DETAIL_ROW_LIMIT = 30000;

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

    const { DATA, detailRows, reportType, fileNames, id } = report;
    const rows = detailRows || [];
    const safeName = sanitizeFilename(fileNames ? fileNames.join('_') : 'report');
    const dateStr = formatDate(new Date());

    let blob, filename, mimeType;

    switch (format) {
        case 'html': {
            // 询问是否包含明细（行数多时默认不包含）
            const opts = await askHtmlExportOptions(rows.length);
            if (!opts) return; // 用户取消
            blob = new Blob([await buildHTML({
                DATA,
                detailRows: opts.includeDetail ? rows : [],
                reportType,
                fileNames,
                id,
                detailIncluded: !!opts.includeDetail,
            })], { type: 'text/html;charset=utf-8' });
            filename = `${safeName}_${dateStr}.html`;
            mimeType = 'text/html';
            break;
        }
        case 'csv':
            blob = buildCSV(rows, reportType);
            filename = `${safeName}_${dateStr}.csv`;
            mimeType = 'text/csv';
            break;
        case 'excel':
            blob = await buildExcel(DATA, rows, reportType);
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

/**
 * 生成自包含 HTML。
 * 关键点：看板 init 已源码级支持 window.__REPORT_DATA__，这里只需内联库 + 注入数据，
 * 不再做任何脆弱的字符串替换；任一步失败直接 throw，绝不静默产出空报告。
 */
async function buildHTML(report) {
    const { DATA, detailRows, reportType, fileNames, id, detailIncluded } = report;
    const dashFile = reportType === 'sales' ? 'sales_dashboard.html' : 'expense_dashboard.html';
    let html = await fetch(dashFile).then(function (r) { return r.text(); });

    // 1. 先注入报告数据。此时 html 还是原始看板，只有一处 </head>，
    //    不会被内联脚本源码里的 </head>（如 html.indexOf('</head>')）干扰定位。
    const payload = {
        DATA: DATA,
        detailRows: detailRows || [],
        id: id || 'export',
        fileNames: fileNames || [],
        reportType: reportType,
        detailIncluded: !!detailIncluded,
    };
    const inject = '<script>\nwindow.__REPORT_DATA__ = ' + safeInlineJSON(payload) + ';\n</script>';
    const headClose = html.indexOf('</head>');
    if (headClose === -1) throw new Error('页面结构异常：缺少 </head>');
    html = html.slice(0, headClose) + inject + '\n' + html.slice(headClose);

    // 2. 内联所有外部 script（echarts/tabulator/...）
    const scriptRe = /<script src="([^"]+)"><\/script>/g;
    const scriptMatches = [];
    let sm;
    while ((sm = scriptRe.exec(html)) !== null) { scriptMatches.push(sm); }
    for (let i = 0; i < scriptMatches.length; i++) {
        const src = scriptMatches[i][1];
        let js;
        try {
            js = await fetch(src).then(function (r) { return r.text(); });
        } catch (e) {
            throw new Error('内联脚本失败: ' + src);
        }
        // 转义代码里的 <script / </script / <!--，防止内联时被 HTML 解析器误判为标签
        js = js.replace(/<(\/?script|!--)/gi, '\\u003c$1');
        html = html.replace(scriptMatches[i][0], '<script>\n' + js + '\n</script>');
    }

    // 3. 内联所有外部 CSS
    const linkRe = /<link href="([^"]+)" rel="stylesheet">/g;
    const linkMatches = [];
    let lm;
    while ((lm = linkRe.exec(html)) !== null) { linkMatches.push(lm); }
    for (let j = 0; j < linkMatches.length; j++) {
        const href = linkMatches[j][1];
        let css;
        try {
            css = await fetch(href).then(function (r) { return r.text(); });
        } catch (e) {
            throw new Error('内联样式失败: ' + href);
        }
        html = html.replace(linkMatches[j][0], '<style>\n' + css + '\n</style>');
    }

    return html;
}

/**
 * 把对象安全地内联为 JS 字面量：
 * - 转义 < 防止脚本标签提前闭合 / HTML 注释干扰
 * - 转义 \u2028 / \u2029（行分隔符，否则 JS 字符串字面量 SyntaxError）
 */
function safeInlineJSON(obj) {
    return JSON.stringify(obj)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

/**
 * 询问 HTML 导出的明细选项。取消返回 null。
 */
function askHtmlExportOptions(rowCount) {
    return new Promise(function (resolve) {
        const includeDetail = rowCount <= HTML_DETAIL_ROW_LIMIT;
        const sizeText = estimateRowsSize(rowCount);
        const detailText = rowCount > 0
            ? '明细数据 ' + rowCount.toLocaleString() + ' 行（约 ' + sizeText + '）'
            : '（当前无明细数据）';

        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:10000;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif';
        overlay.innerHTML =
            '<div style="background:#1a1a3a;border:1px solid #2a2a5a;border-radius:12px;padding:24px;min-width:360px;max-width:520px;color:#e0e0f0;box-shadow:0 12px 48px rgba(0,0,0,.5)">' +
                '<div style="font-size:16px;font-weight:700;margin-bottom:12px">📥 导出 HTML 报告</div>' +
                '<div style="font-size:13px;color:#a0a8c0;line-height:1.6;margin-bottom:16px">8 个 Tab 的图表与全部分析结果将一并导出，可离线交互。</div>' +
                '<label style="display:flex;align-items:center;gap:10px;font-size:14px;padding:12px;background:#12122a;border-radius:8px;cursor:pointer">' +
                    '<input type="checkbox" id="expDetailChk" ' + (includeDetail ? 'checked' : '') + ' style="width:18px;height:18px;flex:0 0 auto">' +
                    '<span>包含明细数据 <span style="color:#a0a8c0;font-size:12px">' + detailText + '</span></span>' +
                '</label>' +
                (rowCount > HTML_DETAIL_ROW_LIMIT ? '<div style="font-size:12px;color:#ffa726;margin-top:8px">⚠️ 明细行较多，导出文件偏大、打开较慢。</div>' : '') +
                '<div style="display:flex;gap:10px;margin-top:20px;justify-content:flex-end">' +
                    '<button id="expCancel" style="padding:8px 16px;background:#2a2a5a;color:#e0e0f0;border:1px solid #3a3a6a;border-radius:6px;cursor:pointer;font-size:13px">取消</button>' +
                    '<button id="expGo" style="padding:8px 20px;background:#4caf84;color:#08120c;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:700">导出</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(overlay);

        function close(val) {
            document.body.removeChild(overlay);
            resolve(val);
        }
        overlay.querySelector('#expCancel').onclick = function () { close(null); };
        overlay.querySelector('#expGo').onclick = function () { close({ includeDetail: overlay.querySelector('#expDetailChk').checked }); };
        overlay.addEventListener('click', function (e) { if (e.target === overlay) close(null); });
    });
}

function estimateRowsSize(rowCount) {
    if (!rowCount) return '0 KB';
    const bytes = rowCount * 200; // 每行约 200 字节（字段名+值），粗估
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
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
