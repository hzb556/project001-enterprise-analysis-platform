# 财务分析平台

企业财务数据深度诊断与销售分析 SaaS 平台。

## 功能模块

### 费用分析
- KPI 总览（4 科目：制造/管理/研发/销售费用）
- 年度对比柱状图 + 月度趋势折线图
- 科目 × 部门 / 科目 × 核算项目 热力图（支持期间对比、环比/同比）
- 科目层级旭日图（双向可钻取）
- 异常检测（环比波动 >30%、IQR 离群值、变异系数）
- 固定/变动成本分类、CAGR、结构偏移分析
- 诊断报告自动生成
- 明细表（筛选、排序、分页、CSV 导出）

### 销售分析
- 8 个分析 Tab：总览 / 客户 / 产品 / 品类 / 部门 / 业务员 / 品牌 / 明细
- KPI 卡片（收入、毛利率、毛利额、客户数、客单价，均带同比）
- 年度收入柱状图 + 月度收入/毛利双线趋势图（智能窗口 + 异常标记）
- 客户分析：Top10 排行 + 收入 vs 毛利率散点图 + 钻取（产品构成/月度走势）
- 产品分析：排行 + 旭日图 + 钻取（趋势/客户构成）
- 品类分析：KPI 卡片 + 月度趋势多折线 + 结构变化对比
- 部门对比：双部门 KPI + 月度走势双折线
- 业务员分析：排行 + 散点图 + 客户数/客单价
- 品牌分析：KPI 卡片 + 月度趋势 + 毛利率柱状图
- 客户流失预警、集中度风险评估
- 诊断报告自动生成
- 明细表（多维筛选：年份/部门/关键词）

## 技术栈

| 层 | 技术 |
|---|------|
| 后端 | Python 3.12 + Flask + SQLAlchemy + pandas + numpy |
| 前端 | ECharts 5.5 + Vanilla JS + Jinja2 模板 |
| 数据库 | SQLite（可替换为 PostgreSQL） |
| 部署 | Docker + Gunicorn + Nginx |
| Excel | openpyxl（服务端）+ SheetJS/xlsx（浏览器端） |

## 目录结构

```
├── app.py                   # Flask 应用工厂 + 认证 + 管理后台
├── config.py                # 配置（开发/生产环境）
├── models.py                # 数据模型（User, Report）
├── security.py              # RBAC + 审计日志 + CSRF + 频率限制 + 密码强度 + 安全头
├── wsgi.py                  # Gunicorn 入口
├── requirements.txt
├── Dockerfile / docker-compose.yml / nginx.conf
├── DEPLOY.md                # 部署指南
├── VERSION.txt
│
├── modules/
│   ├── expense/             # 费用分析模块
│   │   ├── routes.py        # 路由（上传/分析/报告/保存）
│   │   ├── processor.py     # 数据分析引擎
│   │   ├── column_defs.py   # 字段定义（10 个字段）
│   │   └── demo_data.py     # 演示数据生成
│   └── sales/               # 销售分析模块
│       ├── routes.py
│       ├── processor.py     # 数据分析引擎（15 个字段）
│       ├── column_defs.py
│       └── demo_data.py
│
├── shared/                  # 共享工具
│   ├── encoder.py           # Numpy 安全 JSON 编码器
│   ├── date_parser.py       # 多格式日期解析
│   ├── column_detector.py   # 列名自动识别引擎
│   └── excel_reader.py      # Excel 文件读取
│
├── templates/
│   ├── auth/                # 登录/注册
│   ├── expense/             # 费用看板 + 上传页
│   ├── sales/               # 销售看板 + 上传页
│   ├── admin.html           # 管理后台
│   ├── pricing.html         # 定价页
│   └── privacy.html         # 隐私政策
│
├── test_*.py                # 7 个测试文件，49 个用例
│
└── static/js/
    ├── shared/              # 共享 JS 工具
    ├── expense/             # 费用分析浏览器端处理
    └── sales/               # 销售分析浏览器端处理
```

## 快速开始

```bash
# 1. 安装依赖
pip install -r requirements.txt

# 2. 创建 .env 文件（开发环境可跳过，自动使用默认值）
cp .env.example .env

# 3. 初始化数据库
python -c "from app import create_app; from models import db; app = create_app(); app.app_context().push(); db.create_all()"

# 4. 启动
python app.py
# 访问 http://localhost:5000
# 体验 Demo: http://localhost:5000/demo（费用分析）
#            http://localhost:5000/sales/demo（销售分析）
```

## 环境变量

| 变量 | 说明 | 默认值（开发） |
|------|------|--------------|
| `FLASK_ENV` | 运行环境 | `development` |
| `SECRET_KEY` | Flask 密钥 | 开发默认值（生产必须设置） |
| `DATABASE_URL` | 数据库连接 | `sqlite:///app.db` |
| `ADMIN_EMAIL` | 管理员邮箱 | `admin@example.com` |
| `ADMIN_PASSWORD` | 管理员密码 | 开发：`admin123` / 生产：自动生成 |

## 部署

详见 [DEPLOY.md](DEPLOY.md)。生产环境使用：

```bash
docker-compose up -d          # Gunicorn + Nginx
# 或
gunicorn wsgi:app -w 4 -b 0.0.0.0:8000  # 配合 Nginx 反向代理
```

## 版本

当前版本：**v1.5.0** — 见 [CHANGELOG.md](CHANGELOG.md)
