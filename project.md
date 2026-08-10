# 企业运营分析平台

> **独立仓库**：[project001-enterprise-analysis-platform](https://github.com/hzb556/project001-enterprise-analysis-platform)
> **工厂位置**：`projects/1-active/project001-enterprise-analysis-platform/`（Git Submodule）
> **当前版本**：v8.1（纯前端 + 轻量后端）
> **项目状态**：🟢 活跃开发

---

## 架构

```
≤50MB 文件                             >50MB 文件（内部版）
浏览器处理                              服务端 pandas 处理
┌────────────────────┐                 ┌─────────────────────┐
│ SheetJS/calamine   │                 │ 上传 → 分析 → 删文件  │
│ 列检测 → 映射确认   │    ← API →     │ 列映射 → pandas     │
│ 本地分析 + 渲染     │                 │ 仅保留汇总结果       │
└────────────────────┘                 └─────────────────────┘
```

## 文件大小策略

| 大小 | 引擎 | 方式 |
|------|------|------|
| ≤50MB | SheetJS（xlsx）/ calamine（xls） | 浏览器 |
| >50MB | Python pandas | 服务端（内部版）/ 提示拆分（商用版） |

开关：`js/shared/config.js` → `enableLargeFileServer` → `true`=内部版 / `false`=商用版

## 三段式列映射流程

```
① 读表头（1KB，秒级）→ ② 列检测 + 用户确认映射 → ③ 按映射处理
```
不管文件大小，始终先做列检测。用户可在映射窗口手动修正错误的自动匹配。

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | Vanilla JS + ECharts 5.5 + Tabulator 6.3 |
| Excel 读取 | SheetJS（xlsx）+ calamine WASM（xls） |
| 后端 | Python Flask + SQLAlchemy（轻量，只管认证+存储） |
| 数据库 | SQLite |
| 大文件 | Python pandas + openpyxl（服务端） |

## 模块

### 费用分析
- KPI 仪表盘 + 年度/月度趋势 + 科目×部门热力图 + 旭日图
- 异常检测、固定/变动成本、CAGR、诊断报告

### 销售分析
- 8 Tab：总览/客户/产品/品类/部门/业务员/品牌/明细
- 客户 ABC 分层、流失预警、产品生命周期、帕累托、桑基图

## 编码规范

1. **JS 全局函数加模块前缀**：expense 和 sales 的 `validateAndClean`/`processData`/`processExcelFiles`/`mergeFiles` 必须加 `expense*`/`sales*` 前缀，避免覆盖
2. **异步数据加载**：所有依赖 `D`/`R` 的初始化代码放在 `init()` 的 `await loadReport()` 之后，不可在顶层直接访问
3. **Tabulator 时序**：过滤器函数在表未就绪时静默失败，需用 `_pendingFilter` 延迟重试
4. **大文件栈溢出**：`[...new Set()]` 改用 `Array.from(new Set())`；递归改迭代+setTimeout
5. **日期解析**：calamine 返回的日期可能是字符串 `"45777"` 而非数字，需 parseFloat 转换
6. **修改超过 3 轮未解决** → 从 Git 恢复原版重做，避免手工修补累积错误

## 调试工具

Intent Browser（灵犀页镜）：`D:/AI项目/intent-browser/`
```bash
node bin/intent-browser.js http://localhost:5000 --port 17345
```
启动时加 `--disable-http-cache` 避免缓存干扰。

## 版本历史

| 日期 | 版本 | 变更 |
|------|------|------|
| 2026-08-10 | v8.1 | 大文件服务端处理、三段式列映射、NaN/ym/gross_profit 修复 |
| 2026-08-03 | v8.0 | 纯前端化 + 轻量 Flask + Submodule 独立仓库 |
| 2026-07-27 | v7.0 | SaaS 商业版（Flask 全栈） |
| 2026-07-16 | v1.5.1 | 接入 AI_FACTORY |
