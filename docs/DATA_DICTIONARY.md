# 数据字典

> **用途**：D 数据（聚合）和 R 数据（明细行）的完整字段参考。AI 开发时避免字段名拼写错误。
> **维护**：数据结构变更时必须同步更新此文档。

---

## 一、D 数据（聚合数据）

**来源**：`modules/sales/processor.py` → `process_dataframe()` → `DATA` 字典
**注入方式**：`render_template('sales/dashboard.html', data=DATA)` → 前端 `var D = JSON.parse(...)`
**大小**：约 200-500KB（JSON 序列化后）

### 1. 基础信息

| 字段 | 类型 | 示例 | 说明 |
|------|------|------|------|
| `D.report_type` | string | `"sales"` | 报告类型标识 |
| `D.years` | int[] | `[2024, 2025]` | 数据覆盖的所有年份（升序） |
| `D.cy` | int | `2025` | 当前年（`years` 的最后一年） |
| `D.lm` | int | `12` | 当前年的最新月份 |
| `D.yms` | string[] | `["2024-01", ...]` | 所有年月字符串（升序） |

### 2. KPI

| 字段 | 类型 | 说明 |
|------|------|------|
| `D.kpi` | object | 当前年（cy）的 KPI 汇总 |
| `D.kpi.revenue` | float | 当期收入（元） |
| `D.kpi.revenue_prev` | float | 上年同期收入（元） |
| `D.kpi.revenue_yoy` | float\|null | 收入同比增长率（%，如 15.2） |
| `D.kpi.gross_profit` | float | 毛利额（元） |
| `D.kpi.gross_profit_prev` | float | 上年同期毛利额 |
| `D.kpi.gp_margin` | float | 毛利率（%，如 28.5） |
| `D.kpi.gp_margin_prev` | float | 上年同期毛利率（%） |
| `D.kpi.customers` | int | 成交客户数 |
| `D.kpi.customers_prev` | int | 上年同期客户数 |
| `D.kpi.orders` | int | 订单数 |
| `D.kpi.avg_order` | float | 客单价（元） |
| `D.kpiByYear` | object | 各年份 KPI（key 为年份字符串） |

### 3. 趋势数据

| 字段 | 类型 | 说明 |
|------|------|------|
| `D.yrRevenue` | float[] | 各年收入（万元），索引对齐 `D.years` |
| `D.moRevenue` | float[] | 各月收入（万元），索引对齐 `D.yms` |
| `D.moGrossProfit` | float[] | 各月毛利额（万元），索引对齐 `D.yms` |
| `D.cagr` | float | 收入 CAGR（%） |

### 4. 维度列表

| 字段 | 类型 | 元素结构 |
|------|------|---------|
| `D.customers` | object[] | `{id: string, name: string, amt: float}` — Top40 客户 |
| `D.products` | object[] | `{id: string, name: string, amt: float}` — Top30 产品 |
| `D.categories` | object[] | `{id: string, name: string, amt: float}` — 品类列表 |
| `D.salespersons` | object[] | `{id: string, name: string, amt: float}` — Top20 业务员 |
| `D.departments` | object[] | `{id: string, name: string, amt: float}` — 部门列表 |
| `D.brands` | object[] | `{id: string, name: string, amt: float}` — 品牌列表 |
| `D.regions` | object[] | `{id: string, name: string, amt: float}` — 区域列表 |

### 5. 各维度收入（按年数组）

**所有 `*Revenue` 字段的 value 都是数组，长度 = `D.years.length`，索引对齐年份。**

| 字段 | 类型 | 说明 |
|------|------|------|
| `D.custRevenue` | `{客户id: float[]}` | 每个客户各年收入（万元） |
| `D.prodRevenue` | `{产品id: float[]}` | 每个产品各年收入（万元） |
| `D.catRevenue` | `{品类id: float[]}` | 每个品类各年收入（万元） |
| `D.spRevenue` | `{业务员id: float[]}` | 每个业务员各年收入（万元） |
| `D.deptRevenue` | `{部门id: float[]}` | 每个部门各年收入（万元） |
| `D.brandRevenue` | `{品牌id: float[]}` | 每个品牌各年收入（万元） |

### 6. 各维度毛利率（按年数组）

**所有 `*GPMargin` 字段的 value 都是数组！索引对齐 `D.years`。不是单值！**

| 字段 | 类型 | 说明 |
|------|------|------|
| `D.custGPMargin` | `{客户id: float}` | 客户毛利率（%，单值—当前年） |
| `D.prodGPMargin` | `{产品id: float}` | 产品毛利率（%，单值—当前年） |
| `D.catGPMargin` | `{品类id: float[]}` | 品类毛利率数组（%） |
| `D.spGPMargin` | `{业务员id: float[]}` | 业务员毛利率数组（%） |
| `D.deptGPMargin` | `{部门id: float[]}` | 部门毛利率数组（%） |
| `D.brandGPMargin` | `{品牌id: float[]}` | 品牌毛利率数组（%） |

> ⚠️ **重要**：`custGPMargin` 和 `prodGPMargin` 是单值（只有当前年），其余都是按年数组！

### 7. 月度趋势

| 字段 | 类型 | 说明 |
|------|------|------|
| `D.custMonthly` | `{客户id: {ym: float}}` | 客户每月收入（万元），key 为 ym 字符串 |
| `D.prodMonthly` | `{产品id: float[]}` | 产品每月收入（万元），索引对齐 `D.yms` |
| `D.catMonthly` | `{品类id: float[]}` | 品类每月收入（万元） |
| `D.deptMonthly` | `{部门id: float[]}` | 部门每月收入（万元） |
| `D.brandMonthly` | `{品牌id: float[]}` | 品牌每月收入（万元） |

### 8. 客户相关

| 字段 | 类型 | 说明 |
|------|------|------|
| `D.custYoY` | `{客户id: float\|null}` | 客户收入同比增长率（%） |
| `D.custCost` | `{客户id: float}` | 客户成本（万元） |
| `D.custGP` | `{客户id: float}` | 客户毛利额（万元） |
| `D.custPareto` | object[] | 客户 ABC 分层 `{name, revenue(万), cumPct, tier}` |
| `D.custStatus` | `{客户名: {tier, status, recentOrders}}` | 客户状态映射 |
| `D.custConcentration` | object[] | Top10 客户收入占比 `{name, amt(万), pct}` |
| `D.topCustomers` | object[] | Top10 客户简要 `{n: 名称, a: 收入(万)}` |
| `D.topProducts` | object[] | Top10 产品简要 `{n: 名称, a: 收入(万)}` |
| `D.spCustomers` | `{业务员id: int[]}` | 每个业务员各年客户数（按年数组） |

### 9. 流转分析

| 字段 | 类型 | 说明 |
|------|------|------|
| `D.custMigration` | object | 桑基图数据 `{nodes: [{name}], links: [{source, target, value}]}` |
| `D.newCustomers` | object[] | 新增客户列表 `{name, revenue(万), last_ym}` |
| `D.churnRisk` | object[] | 沉睡客户列表 `{name, last_ym, last_amt(万)}` |
| `D.lostCustomers` | object[] | 流失客户列表 `{name, revenue(万), last_ym}` |

### 10. 图表专用

| 字段 | 类型 | 说明 |
|------|------|------|
| `D.sunburstByYear` | object | 客户旭日图（按年） |
| `D.sunburstProdByYear` | object | 产品旭日图（按年） |
| `D.custProdHM` | `{客户id: {产品id: float}}` | 客户×产品交叉金额（全时期） |
| `D.custProdHMByYear` | `{年: {客户id: {产品id: float}}}` | 客户×产品交叉金额（按年） |
| `D.deptCustRevenue` | `{部门id: {客户id: float[]}}` | 部门×客户收入（按年数组） |

### 11. 其他

| 字段 | 类型 | 说明 |
|------|------|------|
| `D.regionData` | object[] | 区域汇总 `{name, amt(万), pct, customers, products}` |
| `D.channelData` | object[] | 渠道汇总 `{name, amt(万), pct}` |
| `D.momAnom` | object[] | 环比异常 `{ym, prev(万), curr(万), mom(%)}` |
| `D.iqr` | object[] | IQR 离群值 `{y, m, customer, product, amt(万)}` |
| `D.diagHTML` | string | 诊断结论 HTML 字符串 |

---

## 二、R 数据（明细行）

**来源**：`process_dataframe()` → `detail_rows` 列表
**获取方式**：`fetch('/sales/api/rows/' + reportId)` → 前端 `var R = [...]`
**大小**：约 58,000 行，JSON 序列化后约 22MB

### 字段速查表

| 字段 | 类型 | 示例 | 说明 | D 数据对应字段 |
|------|------|------|------|--------------|
| `r.y` | int | `2025` | **年份**（不是 `r.year`！） | `D.cy` |
| `r.m` | int | `12` | 月份 | — |
| `r.ym` | string | `"2025-12"` | 年月字符串 | `D.yms[i]` |
| `r.customer` | string | `"桐乡圆融"` | **客户名**（不是 `r.name`！） | `D.customers[].name` |
| `r.product` | string | `"钛杯500ml"` | 产品名 | `D.products[].name` |
| `r.cat` | string | `"钛杯"` | **品类**（不是 `r.category`！） | `D.categories[].name` |
| `r.region` | string | `"华东"` | 区域 | `D.regions[].name` |
| `r.channel` | string | `"线上"` | 渠道 | — |
| `r.dept` | string | `"营销中心"` | **部门**（不是 `r.department`！） | `D.departments[].name` |
| `r.brand` | string | `"十八藏"` | 品牌 | `D.brands[].name` |
| `r.sp` | string | `"张三"` | **业务员**（不是 `r.salesperson`！） | `D.salespersons[].name` |
| `r.qty` | float | `100.0` | 数量 | — |
| `r.price` | float | `25.5` | 单价 | — |
| `r.amt` | float | `2550.00` | **金额（元）**（不是 `r.amount`！） | — |
| `r.cost` | float | `1800.00` | 成本（元） | — |
| `r.gp` | float | `750.00` | **毛利**（不是 `r.gross_profit`！） | — |
| `r.order` | string | `"SO202512001"` | 订单号 | — |
| `r.remark` | string | `""` | 备注（截断到 100 字符） | — |

### R 数据使用注意事项

1. **字段名全部是短名**：`y` 不是 `year`，`cat` 不是 `category`，`dept` 不是 `department`，`sp` 不是 `salesperson`
2. **金额单位是元**：`r.amt` 是原始金额（元），图表显示时需 `/10000/10` 转换为万元并保留 1 位小数
3. **R 数据按需加载**：页面初始加载时 R 为空数组，点下钻时才通过 API 获取
4. **过滤年份用 `r.y`**：`r.y === selY`，不是 `r.year === selY`

---

## 三、数据流示意

```
Excel 文件
  ↓ pd.read_excel()
DataFrame (pandas)
  ↓ process_dataframe(df)
DATA (dict) + detail_rows (list)
  ↓ json.dumps(NpEncoder)
  ↓
  ├─→ render_template('dashboard.html', data=DATA)
  │     ↓ {{ data | tojson | safe }}
  │   var D = ...  (页面内联)
  │
  ├─→ /sales/api/rows/<id>
  │     ↓ jsonify(detail_rows)
  │   var R = ...  (AJAX 按需加载)
  │
  └─→ Report.set_data(DATA, detail_rows)
        ↓ json.dumps → DB
      Report.get_data() / get_rows()
```

---

## 四、金额单位转换速查

| 场景 | 原始单位 | 目标单位 | 转换 |
|------|---------|---------|------|
| D 数据图表值 | 元 | 万元 | 已在 Python 中 `/10000` |
| R 数据图表值 | 元 | 万元 | JS 中 `/10000`，保留 1 位小数 |
| D.kpi.revenue | 元 | — | 原始值，使用时 `/10000` |
| 毛利率 | 小数 | 百分比 | 已在 Python 中 `×100` |

---

## 五、空值处理

| 场景 | 值 |
|------|-----|
| 毛利率分母为 0 | `0` |
| 同比上年数据为 0 | `null`（前端判断后显示 "N/A"） |
| 空客户/产品名 | `"未知"` |
| 空金额/成本 | `0` |
| 空备注 | `""` |
