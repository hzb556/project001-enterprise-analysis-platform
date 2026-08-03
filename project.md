# 企业运营分析平台

> **独立仓库**：enterprise-analysis-platform
> **创建日期**：2026-07-16（接入工厂日期）
> **原始创建**：2026-05（v1.0.0）
> **当前版本**：v1.5.1
> **项目状态**：🟢 活跃

---

## 项目名称

**企业运营分析平台** — 企业财务数据深度诊断与销售分析 SaaS 平台

## 一句话描述

用户上传 Excel 财务/销售数据 → 系统自动生成包含图表、诊断结论、明细表的完整分析报告。

## 项目目标

为中小企业提供零门槛的自助式商业智能（BI）工具，把"需要 Excel 高手 + 财务背景 + 一整天时间"的数据分析工作，变成"上传文件 → 3 分钟出报告"。

## 技术栈

| 层 | 技术 |
|---|------|
| 后端 | Python 3.12 + Flask + SQLAlchemy + pandas + numpy |
| 前端 | ECharts 5.5 + Vanilla JS + Jinja2 模板 |
| 数据库 | SQLite（app.db, ~56MB, 可迁移 PostgreSQL） |
| 部署 | Docker + Gunicorn + Nginx |
| Excel | openpyxl（服务端）+ SheetJS/xlsx（浏览器端） |

## 主要模块

### 模块 A：费用分析（expense）
- KPI 仪表盘（总费用/同比/环比/科目占比）
- 年度对比柱状图 + 月度趋势折线图
- 科目 × 部门热力图
- 科目层级旭日图（双向可钻取）
- 异常检测（环比波动 >30%、IQR 离群值、变异系数）
- 固定/变动成本分类、CAGR、结构偏移分析
- 诊断报告自动生成

### 模块 B：销售分析（sales）
- 8 个分析 Tab：总览 / 客户 / 产品 / 品类 / 部门 / 业务员 / 品牌 / 明细
- 客户 ABC 分层 + 流失预警 + 新增追踪
- 产品排名 + 毛利率矩阵 + 生命周期
- 收入/毛利/客户数 KPI 卡片（均带同比）
- 诊断报告自动生成

### 模块 C：用户与安全系统
- 邮箱注册/登录 + 套餐分级（免费/基础/专业/内部）
- RBAC 三级角色（admin/manager/user）
- 模块权限控制
- 审计日志（8种事件类型，自动脱敏）
- CSRF 防护（HMAC-SHA256）
- Session 安全（HttpOnly + SameSite + 强制改密）

## 目录结构

```
enterprise-analysis-platform/
├── project.md                    # 本文件
├── CHANGELOG.md                  # 工厂级变更日志
├── src/                          # 源代码
│   ├── app.py                    #   Flask 应用工厂 (677行)
│   ├── config.py                 #   多环境配置
│   ├── models.py                 #   数据模型 (User/Report/AuditLog)
│   ├── security.py               #   安全模块 (RBAC+CSRF+审计)
│   ├── wsgi.py                   #   Gunicorn 入口
│   ├── processor.py              #   向后兼容重导出
│   ├── requirements.txt          #   依赖清单
│   ├── modules/                  #   业务模块
│   │   ├── expense/              #     费用分析模块
│   │   └── sales/                #     销售分析模块
│   ├── shared/                   #   共享工具
│   ├── templates/                #   Jinja2 模板 (18个)
│   └── static/                   #   静态资源 (JS)
├── tests/                        # 测试代码 (7文件, 49用例)
├── docs/                         # 项目文档
├── deploy/                       # 部署配置
└── .claude/                      # AI Agent 配置
    └── project.md                #   项目级 AI 规则
```

## 当前版本

**v1.5.1**（2026-07-16）

- 费用分析：完整（KPI + 图表 + 异常检测 + 诊断 + 导出）
- 销售分析：完整（8 页签全部完成，含下钻）
- 用户系统：完整（注册/登录/权限/套餐/管理后台）
- 安全架构：完整（RBAC + 审计日志 + CSRF + Session 加固）
- 部署方案：完整（Docker + Gunicorn + Nginx）
- 测试覆盖：7 文件 49 用例

## 接入工厂历史

| 日期 | 事件 |
|------|------|
| 2026-07-16 | 项目001接入 AI_FACTORY，归档至 `projects/enterprise-analysis-platform/` |
