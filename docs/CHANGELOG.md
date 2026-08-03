# CHANGELOG

> 所有显著变更记录。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。
> 版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---

## [1.5.1] — 2026-07-16

### 修复
- **业务员气泡图异常毛利率过滤**：收入 vs 毛利率散点图中，异常毛利率（< -100% 或 > 100%）导致坐标轴失真

### 技术方案
- **纯前端过滤**：在 `renderSpScatter()` 中过滤异常数据点，不修改后端 processor.py
- **过滤规则**：`gpMargin < -100 || gpMargin > 100` 视为异常，不进入 ECharts 数据序列
- **用户提示**：页面显示橙黄色提示条，列出被过滤的业务员名称和毛利率值
- **数据安全**：仅图表展示层过滤，原始数据（D/R 数据、数据库）不受影响

### 修改文件
| 文件 | 改动 | 说明 |
|------|------|------|
| `templates/sales/dashboard.html` | +14/-2 | `renderSpScatter()` 新增过滤 + `spScatterNote` 提示容器 |

### 验收结果
| # | 验收项 | 结果 |
|---|--------|------|
| 1 | 朱莹莹 -656.3% 不在气泡图中显示 | ✅ |
| 2 | 正常毛利率业务员正常显示 | ✅ |
| 3 | 气泡大小仍按客户数计算 | ✅ |
| 4 | 坐标轴不再因子据失真 | ✅ |
| 5 | 原始数据未删除 | ✅ |
| 6 | Flask 模板缓存已刷新 | ✅ |

### 关联经验
- **模板缓存陷阱**：`debug=False` 时 Jinja2 不自动重载模板，修改 HTML 后必须重启 Flask 进程
- **已沉淀到文档**：`AI_DEVELOPMENT_WORKFLOW.md` 新增「前端模板修改专项验收流程」
- **已更新规范**：`CLAUDE.md` 后端约定新增模板缓存提醒

### 版本影响
- 版本号：v1.5.0 → **v1.5.1**（patch）
- 兼容性：完全向下兼容，无破坏性变更
- 部署要求：更新 `templates/sales/dashboard.html` 后**重启 Flask 服务**

---

## [1.5.0] — 2026-07-16

### 新增
- **RBAC 权限模型**：`User.role` 字段（admin/manager/user），替换 `ADMIN_EMAIL` 硬编码判断
- **权限抽象层**：`security.py` 新增 `require_role()` / `require_admin()` / `require_manager()` / `require_module()` 装饰器
- **审计日志系统**：`AuditLog` 表，8 种事件类型（login/logout/password_change/update_user/delete_report/export_report/create_report），自动脱敏敏感字段
- **CSRF 防护**：HMAC-SHA256 token 绑定 session，`@app.before_request` 全局拦截 POST/PUT/DELETE
- **Session 安全增强**：`PERMANENT_SESSION_LIFETIME = 8h`，`SESSION_COOKIE_SAMESITE = 'Lax'`
- **安全测试套件**：7 个测试文件，49 个测试用例（test_basic / test_security / test_rbac / test_permission / test_audit / test_csrf / test_security_hardening）
- **数据库自动迁移**：`app.py` 启动时自动检测并添加 `role`、`force_password_change`、`enabled_modules` 列及 `audit_logs` 表，已有管理员自动提升为 admin 角色

### 变更
- `admin_required` 装饰器从 `app.py` 移至 `security.py`，基于 `role` 判断替代 `email == ADMIN_EMAIL`
- 管理后台页面 / API 统一使用 `@require_admin`
- 登录审计邮箱脱敏（`a***@domain.com`）
- `models.py` 新增 `User.is_admin()` / `is_manager()` / `has_role()` 便捷方法
- `app.py` 生产环境启动检查增强：`SECRET_KEY` 拦截 + 管理员密码自动生成提示

### 修复
- AuditLog `action` 字段增加索引
- CHANGELOG 补充 v1.4.2 安全改造记录
- `config.py` 添加 `ADMIN_PASSWORD_IS_AUTO` / `BOOTSTRAP_KEY_FILE` 配置项

---

## [1.4.2] — 2026-07-15

### 新增
- 生产环境 SECRET_KEY 启动拦截（空/弱/短 → sys.exit(1)）
- ADMIN_PASSWORD 自动生成 + `data/.bootstrap_admin.key` 文件（chmod 0600）
- 首次登录强制改密机制（`force_password_change` + `/change-password` 路由）
- Docker 安全：`${SECRET_KEY:?}` 强制检查，Dockerfile 零硬编码

### 修复
- 消除 config.py / Dockerfile / docker-compose.yml / setup.bat 硬编码密钥
- DEPLOY.md 新增 v1.4.2 安全升级说明

---

## [1.4.1] — 2026-07-15

### 新增
- 品类页签完整深化：年份筛选 + 收入柱状图（含同比%）+ 占比饼图（<5%隐藏引导线）+ 月度趋势 + 结构变化对比 + 明细表下钻（产品构成 + 月度趋势）
- 业务员页签完整深化：聚合 KPI + 收入排行柱状（含均值线）+ 散点图（收入 vs 毛利率，气泡=客户数）+ 明细表下钻（客户构成 + 月度趋势）
- 品牌页签完整深化：年份筛选 + 收入柱状图（含同比%）+ 占比饼图 + 月度走势 + 毛利率对比 + 明细表下钻（产品构成 + 月度趋势）

### 修复
- 修复业务员收入排行图完全不渲染的 bug（`renderSpBar` 中 `avg` 变量未定义，`ReferenceError`）
- 修复部门页签年份筛选不联动 KPI 卡片（后端 `dept_gp_margin` 从单值改为按年数组）
- 修复品类页签年份筛选不联动 KPI 卡片（后端 `cat_gp_margin` 从单值改为按年数组）
- 修复业务员页签年份筛选不联动客户数/毛利率（后端 `sp_customers`/`sp_gp_margin` 从单值改为按年数组）
- 修复品牌页签年份筛选不联动毛利率（后端 `brand_gp_margin` 从单值改为按年数组）
- 修复部门客户占比饼图 <5% 扇区隐藏了标签文字但引导线仍残留
- 修复饼图小标签显示为空而非"无"

### 变更
- 统一 4 个页签筛选栏位置——全部置于页签顶部（参照客户页签规范）
- ECharts grid 边距规范统一：top≥40, bottom≥70(有图例), 禁用 containLabel

---

## [1.4.0] — 2026-07 上旬

### 新增
- 销售分析 8 Tab 全部完成：总览 / 客户 / 产品 / 品类 / 部门 / 业务员 / 品牌 / 明细
- 客户页签全面升级：KPI 卡片 + 帕累托分层 + 桑基流转 + 新增/沉睡/流失明细
- 产品页签深度分析：KPI + 排名变化表 + 气泡图 + 旭日图 + 生命周期 + 下钻
- 部门页签：双部门 KPI 对比 + 月度趋势 + 客户 Top10 + 客户占比 + 明细下钻
- 诊断结论 8 节完整输出（收入/毛利/最新月/客户/产品/区域/建议/口径说明）
- 演示数据模式：无需上传即可体验完整功能
- 真实数据入口

### 修复
- 桑基图与 KPI 三端同源统一口径（新增/沉睡/流失定义完全一致）
- 产品构成年份筛选：明细行字段名 `r.y`（不是 `r.year`）
- 明细表数据源统一：直接用 D 数据渲染，与 KPI/桑基图同源
- 旭日图年份联动 + 树状图部门筛选
- KPI 同比颜色修复（`.up`/`.dn` 改为全局选择器）
- 均值线标签截断问题（多次迭代修复：left/right/top 调整）

---

## [1.3.0] — 2026-06

### 新增
- 模块化架构重构：expense 和 sales 独立为 Blueprint 模块
- 销售分析模块初始框架
- 客户分析页签基础版
- 月度趋势图智能窗口（默认 24 月 + 切换 + 双线 + 异常标记）

### 变更
- 目录结构重组：`modules/expense/`、`modules/sales/`、`shared/`
- 共享工具抽取：encoder、date_parser、column_detector、excel_reader

---

## [1.2.0] — 2026-06

### 修复
- 修复部署包目录结构和缺失文件问题
- 增强 XLSX.read 错误提示
- 科目识别：从按金额排名改为关键词匹配
- 科目与费用项目合并列自动拆分（如"管理费用-工资"→科目+项目）

---

## [1.1.0] — 2026-05

### 新增
- 费用深度诊断看板完整版
- 多文件上传支持
- 表头自动识别引擎
- KPI 仪表盘（总费用/同比/环比）
- 年度对比柱状图 + 月度趋势折线图
- 科目×部门热力图（支持期间对比、环比/同比）
- 科目层级旭日图（双向可钻取）
- 异常检测（环比>30%、IQR 离群值、变异系数）
- 固定/变动成本分类、CAGR、结构偏移分析
- 诊断报告自动生成
- 明细表（筛选、排序、分页、CSV 导出）

---

## [1.0.0] — 2026-05

### 新增
- 初始发布：费用深度诊断看板
- Flask + SQLite 基础架构
- 用户注册/登录系统
- Excel 文件上传与解析
- 基础费用分析功能
