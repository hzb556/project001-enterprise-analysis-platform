/**
 * Tabulator 表格工厂 — 统一创建交互表格
 * 依赖: Tabulator 6.x (CDN)
 *
 * 用法:
 *   buildTable('#myTable', data, [
 *     {title:'客户', field:'customer', sorter:'string'},
 *     {title:'收入', field:'revenue', sorter:'number', formatter:'money'},
 *   ]);
 */

// Tabulator 自定义格式化器
Tabulator.prototype.extendModule('format', 'formatters', {

    // 金额格式化: 12345.67 → ¥12,345.67
    money: function(cell, params) {
        var val = cell.getValue();
        if (val == null) return '-';
        val = parseFloat(val);
        if (params && params.unit === 'wan') val = val * 10000;
        return '¥' + val.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    },

    // 金额(万元): 1234567 → ¥123.46万
    money_wan: function(cell) {
        var val = cell.getValue();
        if (val == null) return '-';
        val = parseFloat(val) / 10000;
        return '¥' + val.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2}) + '万';
    },

    // 百分比: 0.1567 → 15.67%
    percent: function(cell) {
        var val = cell.getValue();
        if (val == null) return '-';
        val = parseFloat(val);
        return val.toFixed(2) + '%';
    },

    // 涨跌: 正值红色↑, 负值绿色↓
    change: function(cell) {
        var val = cell.getValue();
        if (val == null) return '-';
        val = parseFloat(val);
        var cls = val >= 0 ? 'up' : 'dn';
        var arrow = val >= 0 ? '↑' : '↓';
        return '<span class="' + cls + '">' + arrow + ' ' + Math.abs(val).toFixed(2) + '%</span>';
    },

    // 排名变化
    rank_change: function(cell) {
        var val = cell.getValue();
        if (val == null || val === 0) return '<span style="color:var(--muted)">─</span>';
        var cls = val > 0 ? 'up' : 'dn';
        var arrow = val > 0 ? '↑' : '↓';
        return '<span class="' + cls + '">' + arrow + Math.abs(val) + '</span>';
    },
});

// ============ 工厂函数 ============

/**
 * 创建标准数据表格
 * @param {string} selector - CSS选择器
 * @param {Array} data - 数据数组
 * @param {Array} columns - 列定义
 * @param {Object} opts - 额外选项
 */
function buildTable(selector, data, columns, opts) {
    opts = opts || {};
    var defaults = {
        data: data,
        columns: columns,
        layout: 'fitColumns',
        height: opts.height || 400,
        maxHeight: opts.maxHeight || 500,
        pagination: opts.pagination !== false,
        paginationSize: opts.paginationSize || 20,
        paginationSizeSelector: [10, 20, 50, 100],
        paginationCounter: 'rows',
        movableColumns: opts.movableColumns !== false,
        resizableColumnFit: true,
        selectable: false,
        placeholder: '暂无数据',
        locale: true,
        langs: {
            'zh-cn': {
                'pagination': {
                    'page_size': '每页',
                    'page_title': '第',
                    'first': '首页',
                    'first_title': '首页',
                    'last': '末页',
                    'last_title': '末页',
                    'prev': '上一页',
                    'prev_title': '上一页',
                    'next': '下一页',
                    'next_title': '下一页',
                    'all': '全部',
                },
                'data': {
                    'loading': '加载中...',
                    'error': '加载失败',
                },
            },
        },
        // 如果有下载功能
        rowContextMenu: opts.enableExport ? [
            {
                label: '📥 导出为 Excel',
                action: function(e, row) {
                    row.getTable().download('xlsx', '数据导出.xlsx', {sheetName: '数据'});
                }
            }
        ] : false,
    };

    // 合并用户选项
    var config = Object.assign({}, defaults, opts);
    // 再次确保 columns 用的是我们传入的 columns
    config.columns = columns;
    config.data = data;

    return new Tabulator(selector, config);
}

/**
 * 快速创建简单列表表格
 */
function buildSimpleTable(selector, data, columns, height) {
    return buildTable(selector, data, columns, {
        height: height || 350,
        pagination: data && data.length > 20,
        paginationSize: 20,
        movableColumns: false,
    });
}

/**
 * 导出当前表格为 Excel
 */
function exportTable(table, filename) {
    table.download('xlsx', filename || '数据导出.xlsx', {sheetName: '数据'});
}
