# 企业运营分析平台 v8.1

> 📊 费用分析 · 📈 销售分析 — 数据在浏览器处理，报告可选存云端

## 快速开始

### 1. 安装依赖

```bash
cd src
pip install -r requirements.txt
```

### 2. 启动服务

```bash
cd src
python app.py
# 打开 http://localhost:5000
```

默认管理员：`admin@example.com` / `admin123`（可通过环境变量 `ADMIN_EMAIL` 和 `ADMIN_PASSWORD` 修改）

### 3. 部署到生产环境

```bash
# 设置环境变量
export FLASK_ENV=production
export SECRET_KEY=<随机生成的安全密钥>
export ADMIN_EMAIL=<你的邮箱>
export ADMIN_PASSWORD=<强密码>

cd src
gunicorn -w 4 -b 0.0.0.0:8000 app:create_app\(\)
```

## 架构

```
浏览器（用户电脑）                    服务器（Flask）
┌─────────────────────┐          ┌──────────────────┐
│ Excel 读取 ── 本地   │          │ 注册/登录         │
│ 列识别   ── 本地     │    ←→   │ 报告列表          │
│ 计算分析 ── 本地     │    API  │ 报告存储（可选）    │
│ 图表渲染 ── 本地     │          │ 用户/权限管理      │
│ 导出下载 ── 本地     │          │                   │
└─────────────────────┘          └──────────────────┘
   数据不离开浏览器                  只管身份和权限
```

## 功能

| 功能 | 说明 |
|------|------|
| 📊 **费用分析** | 拖入费用明细 Excel，自动识别科目/部门/项目 |
| 📈 **销售分析** | 拖入销售明细 Excel，客户分层/产品分析/趋势追踪 |
| 🔒 **本地处理** | Excel 数据永不离开浏览器 |
| ☁️ **可选存云** | 分析完成后可选择保存报告到服务器 |
| 📥 **多格式导出** | HTML / Excel / CSV |
| 👤 **用户系统** | 注册/登录，管理员可管理用户和模块权限 |
| 📋 **历史报告** | 已保存的报告可随时回看 |

## 文件结构

```
├── index.html              # 入口（登录 + 上传 + 历史列表）
├── dashboard.html           # 报告看板
├── js/
│   ├── vendor/              # 第三方库（本地化）
│   ├── shared/              # 共享模块（认证/存储/读取/导出...）
│   ├── expense/             # 费用分析引擎
│   └── sales/               # 销售分析引擎
├── css/                     # 样式
├── data/                    # 演示数据
├── src/                     # 后端
│   ├── app.py               # Flask 应用
│   ├── models.py            # 数据模型
│   ├── config.py            # 配置
│   └── requirements.txt     # Python 依赖
└── README.md
```

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 登出 |
| GET | `/api/auth/me` | 当前用户 |
| GET | `/api/reports` | 报告列表 |
| GET | `/api/reports/<id>` | 报告详情 |
| POST | `/api/reports/save` | 保存报告 |
| DELETE | `/api/reports/<id>` | 删除报告 |
| GET | `/api/admin/users` | 用户列表（管理员） |
| POST | `/api/admin/user/<id>` | 更新用户（管理员） |

## 隐私

✅ Excel 文件**永远不会离开你的浏览器**  
✅ 仅在你主动点击"保存到云端"后，汇总数据才会存到服务器  
✅ 不保存原始文件，只保存分析结果  
✅ 下载报告后浏览器缓存自动清除
