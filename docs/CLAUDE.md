# CLAUDE.md（project001 补充规则）

> ⚠️ 本文件是 project001 专属补充规则。AI 行为的基本规则（任务等级、Git 流程、Commit 格式）以根目录 **`CLAUDE.md`（v4.0 统一版）** 为准。本文件仅定义 project001 的特有约束（如禁止修改 `security.py`、禁止删除文件、项目文件结构等）。

## AI 自动开发模式

> **收到任何开发需求时，必须先执行以下流程。**

### 启动协议

```
用户提出开发需求
      ↓
第一步：读取规范文件
      Read AI_RULES.md
      Read AI_DEVELOPMENT_WORKFLOW.md
      Read AI_AUTONOMOUS_WORKFLOW.md
      ↓
第二步：判断任务等级
      L1（自动）→ 自主执行全流程，输出报告后等待验收
      L2（半自动）→ 需求分析后暂停，等待人工确认方案
      L3（架构）→ 通知人工，不自主执行
      ↓
第三步：执行或等待
      L1 → 创建 feature 分支 → 修改代码 → 测试 → 报告 → 等待"确认"
      L2 → 分析需求 → 输出方案 → 等待"确认" → 执行
      L3 → 输出影响分析 → 等待人工主导
```

### 任务等级速判

| 等级 | 关键词 | 处理方式 |
|------|--------|---------|
| **L1** | 调整/修改/修复/增加小字段/文案/样式/图表配置 | 🤖 自动执行 |
| **L2** | 新增页面/新增接口/数据模型/跨模块 | ✋ 暂停确认 |
| **L3** | 架构/重构/移动端/权限体系/支付 | 🛑 不自主执行 |

### L1 完成后等待指令

L1 任务完成并输出报告后，**必须停止等待**，由人工回复：

| 指令 | 行为 |
|------|------|
| `确认` | 合并到 develop + 清理分支 |
| `修改：xxx` | 继续修改 |
| `放弃` | 删除分支 |

---

## 项目概述

**企业运营分析平台** — 企业财务数据深度诊断与销售分析 SaaS 平台。

用户上传 Excel 财务数据 → 系统自动清洗/分析 → 生成可视化报告（ECharts 图表 + 诊断结论 + 明细表）。

## 技术栈

| 层 | 技术 |
|---|------|
| 后端 | Python 3.12 + Flask + SQLAlchemy + pandas + numpy |
| 前端 | ECharts 5.5 + Vanilla JS + Jinja2 模板 |
| 数据库 | SQLite（app.db, ~56MB） |
| 部署 | Docker + Gunicorn + Nginx |

## 目录结构

```
├── app.py                   # Flask 应用工厂 + 认证 + 管理后台 (676行)
├── config.py                # 环境配置（开发/生产）
├── models.py                # User + Report + AuditLog 数据模型
├── security.py              # RBAC + 审计日志 + CSRF + 频率限制 (275行)
├── modules/
│   ├── expense/             # 费用分析模块
│   │   ├── routes.py        # 上传/分析/报告路由
│   │   ├── processor.py     # 数据分析引擎
│   │   └── demo_data.py     # 演示数据生成
│   └── sales/               # 销售分析模块
│       ├── routes.py        # 路由 + demo/real 数据缓存 (429行)
│       ├── processor.py     # 核心分析引擎 (795行)
│       └── demo_data.py     # 演示数据
├── shared/                  # 共享工具（日期解析、Excel读取、列检测）
├── test_basic.py            # 基础冒烟测试
├── test_security.py         # 安全加固测试 (v1.4.2)
├── test_rbac.py             # RBAC 权限测试 (v1.5.0)
├── test_permission.py       # 权限装饰器测试 (v1.5.0)
├── test_audit.py            # 审计日志测试 (v1.5.0)
├── test_csrf.py             # CSRF 防护测试 (v1.5.0)
├── test_security_hardening.py # 安全集成测试 (v1.5.0)
├── templates/
│   ├── sales/dashboard.html # 销售看板主页面 (~1800行，8个页签)
│   ├── expense/dashboard.html
│   └── auth/                # 登录/注册
└── static/js/               # 浏览器端 JS 辅助脚本
```

## 关键文件

- `templates/sales/dashboard.html` — 最大最复杂的文件，包含全部 8 个分析页签的前端逻辑
- `modules/sales/processor.py` — 销售数据分析引擎，`process_dataframe()` 函数输出两个核心数据结构
- `app.py` — Flask 应用工厂 `create_app()`，包含认证/管理后台/蓝图注册/安全启动检查/数据库迁移
- `security.py` — 安全核心模块：RBAC 装饰器 + 审计日志 + CSRF 防护 + 频率限制 + 密码验证
- `models.py` — User / Report / AuditLog 三表模型
- `config.py` — 环境配置 + SECRET_KEY 拦截 + ADMIN_PASSWORD 自动生成
- `项目分析框架与设计文档.md` — 业务分析框架文档（中文）

## 核心数据结构

### D 数据（聚合数据，JSON 序列化后注入页面）

Python `process_dataframe()` 返回 → Flask `render_template('sales/dashboard.html', data=DATA)` → 前端 `var D = JSON.parse('{{ data | tojson | safe }}');`

顶层字段：`years`, `cy`(当前年), `lm`(最新月), `yms`(所有年月), `kpi`, `kpiByYear`, `yrRevenue`, `moRevenue`, `moGrossProfit`, `customers`, `products`, `categories`, `custRevenue`, `prodRevenue`, `custProdHM`, `custProdHMByYear`, `custMonthly`, `custCost`, `custGP`, `custGPMargin`, `custYoY`, `prodMonthly`, `prodGPMargin`, `prodYoY`, `catRevenue`, `catMonthly`, `catGPMargin`, `salespersons`, `spRevenue`, `spCustomers`, `spGPMargin`, `departments`, `deptRevenue`, `deptMonthly`, `deptGPMargin`, `deptCustRevenue`, `brands`, `brandRevenue`, `brandMonthly`, `brandGPMargin`, `sunburstByYear`, `sunburstProdByYear`, `regionData`, `channelData`, `momAnom`, `churnRisk`, `newCustomers`, `lostCustomers`, `custPareto`, `custMigration`, `custStatus`, `custConcentration`, `cagr`, `iqr`, `topCustomers`, `topProducts`, `diagHTML`

### R 数据（明细行，按需加载）

通过 API `/sales/api/rows/<report_id>` 异步获取，前端存为 `var R = [...]`。

每行字段：`y`(年), `m`(月), `ym`, `customer`, `product`, `cat`, `region`, `channel`, `dept`, `brand`, `sp`, `qty`, `price`, `amt`, `cost`, `gp`, `order`, `remark`

**注意**: R 数据字段名与 D 数据完全不同！如年份是 `r.y` 不是 `r.year`。

## 开发命令

```bash
# 启动开发服务器
python app.py
# 访问 http://localhost:5000

# 体验演示数据（无需登录）
# 费用分析: http://localhost:5000/demo
# 销售分析: http://localhost:5000/sales/demo

# 运行测试
python test_basic.py
python test_security.py
python test_rbac.py
python test_permission.py
python test_audit.py
python test_csrf.py
python test_security_hardening.py

# 安装依赖
pip install -r requirements.txt

# Docker 部署
docker-compose up -d

# 修改前端模板后重启服务（debug=False 时模板缓存不自动刷新）
# Windows: taskkill //PID <PID> //F && python app.py
# Linux:   pkill -f "python app.py" && python app.py
```

## 架构约定

### 前端
- **无框架**：纯 Vanilla JS，所有图表用 ECharts 5.5
- **全局变量**：`D`（聚合数据）、`R`（明细行）、`ch*`（图表实例）
- **懒加载**：页签切换时通过 `*TabReady` 标志避免重复初始化
- **年份联动**：`parseInt(document.getElementById('xxxFilter').value) || D.cy`
- **年份索引**：`yi = (D.years||[]).indexOf(selY)`

### 后端
- **蓝图注册**：在 `app.py` 的 `create_app()` 中注册
- **数据缓存**：demo/real 数据使用模块级 `_cache` 变量，首次请求处理（~58k 行），后续直接返回
- **JSON 序列化**：必须通过 `NpEncoder` 处理 numpy 类型
- **金额单位**：原始数据为元，图表输出为万元（`/10000`）
- **毛利率**：所有 `*GPMargin` 字段为**按年数组**（与 `all_years` 对齐），不是单值
- **安全**：路由使用 `@require_admin` / `@require_manager` / `@require_module` 装饰器控制权限
- **审计**：关键操作调用 `audit_log()` 记录，非阻塞。8 种事件类型，敏感字段自动脱敏
- **CSRF**：所有 POST/PUT/DELETE 自动拦截，模板注入 `_csrf_token`，AJAX 需 `X-CSRF-Token` header
- **迁移**：SQLite 自动检测并添加缺失列/表（`app.py` with `app.app_context()` 块）
- **模板缓存**：`app.py` 默认 `debug=False`，Jinja2 不自动重载模板。修改 `templates/*.html` 后**必须重启 Flask 进程**才能生效

### ECharts 图表
- `grid.top` ≥ 40（防止顶部标签截断）
- `grid.bottom` = 70（有底部图例）/ 50（无图例）
- 禁止 `containLabel: true`
- 饼图 <5%：per-item `label.show=false` + `labelLine.show=false`

### Git 分支模型（三分支）

```
master     ← 生产稳定（只读，仅人类操作）
develop    ← 日常集成（工作基线）
feature/*  ← AI 隔离开发（每个任务一个分支）
```

- **分支策略**：见 [AI_DEVELOPMENT_WORKFLOW.md](AI_DEVELOPMENT_WORKFLOW.md)
- **AI 必须在 `feature/<任务名>` 分支上开发，禁止直接操作 master**
- 每次改动后自动 commit + push（仅限当前 feature 分支）
- Commit 格式：`type: 中文描述`（feat/fix/refactor/style/docs/chore/test/security）
- 发布：develop → merge master → tag 版本号
- 回滚：`git revert -m 1 <merge-commit>` 或 hotfix 分支

## 项目状态

- 版本：v1.5.0
- 提交数：~160
- 代码量：~14,000 行（Python ~3,550 + 模板 ~9,930 + JS/CSS/配置）
- 功能完成度：~90%（核心分析 + 安全架构完整，待上线打磨）
- 测试覆盖：7 个测试文件，共 49 个测试用例（基础/安全/RBAC/权限/审计/CSRF/集成）
- 数据库：SQLite 56MB，58,654 条交易记录
