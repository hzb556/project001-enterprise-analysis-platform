# AI Agent 项目规则 — 企业运营分析平台

> 本文件是企业运营分析平台的 AI Agent 工作规则。
> 继承工厂通用规则（见 `factory_os/`），以下为项目专属约束。

---

## 项目信息

- **工厂编号**：project001_customer_analysis
- **项目类型**：Flask + Vanilla JS SaaS 应用
- **Python 版本**：3.12
- **入口文件**：`src/app.py`
- **测试命令**：`cd src && python -m pytest ../tests/`

## 项目专属约束

### 绝对禁止

| 禁止事项 | 原因 |
|---------|------|
| ❌ 删除或重构 `src/modules/sales/processor.py` | 核心计算引擎（795行），改动风险极高 |
| ❌ 删除或重构 `src/security.py` | RBAC + 审计 + CSRF + 频率限制，安全核心 |
| ❌ 直接修改 `src/models.py` 数据模型 | User/Report/AuditLog 三表，改模型可能丢数据 |
| ❌ 引入新的 Python 依赖 | 除非用户明确要求 |
| ❌ 引入前端框架（Vue/React 等） | 项目使用 Vanilla JS + ECharts |

### 架构约定

- **后端**：Flask 应用工厂模式，Blueprint 模块化
- **前端**：全局变量 D（聚合数据）/ R（明细行），Tab 懒加载
- **数据**：金额单位为元，图表展示为万元（/10000）
- **JSON**：必须通过 `NpEncoder` 处理 numpy 类型
- **模板缓存**：`debug=False` 时修改 HTML 必须重启 Flask
- **安全**：路由使用 `@require_admin` / `@require_manager` / `@require_module` 控制权限

## 任务等级速判

| 等级 | 关键词 | 处理方式 |
|------|--------|---------|
| **L1** | 调整/修改/修复/文案/样式/图表配置 | 🤖 自动执行 |
| **L2** | 新增页面/新增接口/数据模型/跨模块 | ✋ 暂停确认 |
| **L3** | 架构/重构/移动端/权限体系/支付 | 🛑 不自主执行 |
