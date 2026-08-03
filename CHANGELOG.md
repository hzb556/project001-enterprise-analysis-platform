# CHANGELOG — project001

> 本文件记录项目接入 AI_FACTORY 后的工厂级变更。
> 项目原始变更日志见 `docs/CHANGELOG.md`。

---

## [factory-1] — 2026-07-16

### 变更
- 项目001接入 AI_FACTORY，从 `D:\AI项目\费用分析报告` 迁移至 `projects/project001_customer_analysis/`
- 目录结构标准化：src/ tests/ docs/ deploy/ .claude/
- 创建 project.md 工厂元信息文件
- 创建 .claude/project.md AI Agent 规则文件
- 移除运行时数据（app.db, reports/, uploads/, __pycache__/）
- 精简文件（排除 debug_cols.txt, 部署包 zip）

### 未迁移
- `app.db`（56MB 运行时数据库）
- `reports/`（运行时报告数据）
- `uploads/`（用户上传目录）
- `__pycache__/`（Python 缓存）
- `debug_cols.txt`（调试输出）
- `费用诊断看板-部署包-v1.2.zip`（历史构建产物）
- `.git/`（原项目 Git 历史保留在原目录）
- `knowledge_base/`（项目内空骨架，待工厂统一重建）
