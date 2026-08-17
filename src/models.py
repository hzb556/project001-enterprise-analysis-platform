"""数据模型：User + Report"""
import json
from datetime import datetime

from flask_sqlalchemy import SQLAlchemy
from flask_bcrypt import Bcrypt
from flask_login import UserMixin

db = SQLAlchemy()
bcrypt = Bcrypt()

# ---- 模块配置 ----
MODULES = [
    {'id': 'expense', 'name': '费用分析', 'default': True},
    {'id': 'sales',   'name': '销售分析', 'default': False},
]
MODULE_IDS = [m['id'] for m in MODULES]
DEFAULT_MODULES = json.dumps([m['id'] for m in MODULES if m.get('default')])


class User(db.Model, UserMixin):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(256), nullable=False)
    role = db.Column(db.String(16), default='user')          # 'admin' | 'user'
    enabled_modules = db.Column(db.Text, default=DEFAULT_MODULES)  # JSON list
    status = db.Column(db.String(16), default='active')      # 'active' | 'disabled'
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # 报告用量
    reports_used = db.Column(db.Integer, default=0)
    max_reports = db.Column(db.Integer, default=100)

    def set_password(self, pw):
        self.password_hash = bcrypt.generate_password_hash(pw).decode('utf-8')

    def check_password(self, pw):
        return bcrypt.check_password_hash(self.password_hash, pw)

    def get_enabled_modules(self):
        try:
            mods = json.loads(self.enabled_modules)
            return mods if isinstance(mods, list) else ['expense']
        except Exception:
            return ['expense']

    def has_module(self, module_id):
        return module_id in self.get_enabled_modules() or self.role == 'admin'

    def is_admin(self):
        return self.role == 'admin'

    def can_create_report(self):
        if self.max_reports < 0:
            return True, ''
        if self.reports_used >= self.max_reports:
            return False, '报告数量已达上限，请联系管理员升级'
        return True, ''

    def to_dict(self):
        return {
            'id': self.id,
            'email': self.email,
            'role': self.role,
            'status': self.status,
            'enabled_modules': self.get_enabled_modules(),
            'reports_used': self.reports_used,
            'max_reports': self.max_reports,
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M') if self.created_at else '',
        }


class Report(db.Model):
    __tablename__ = 'reports'

    id = db.Column(db.String(32), primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    report_type = db.Column(db.String(20), default='expense')  # 'expense' | 'sales'
    report_name = db.Column(db.String(200), default='未命名')
    file_count = db.Column(db.Integer, default=0)
    row_count = db.Column(db.Integer, default=0)
    data_json = db.Column(db.Text)       # 分析汇总数据 JSON
    rows_json = db.Column(db.Text)       # 明细行数据 JSON
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship('User', backref=db.backref('reports', lazy=True))

    def set_data(self, data, rows):
        self.data_json = json.dumps(data, ensure_ascii=False)
        # 明细行用数组数组紧凑格式存储（省字段名，减半体积）
        if rows and isinstance(rows, list) and len(rows) > 0:
            cols = list(rows[0].keys())
            data_arr = [[r.get(c) for c in cols] for r in rows]
            self.rows_json = json.dumps({'cols': cols, 'data': data_arr}, ensure_ascii=False)
        else:
            self.rows_json = json.dumps({'cols': [], 'data': []}, ensure_ascii=False)

    def get_data(self):
        try:
            return json.loads(self.data_json) if self.data_json else {}
        except Exception:
            return {}

    def get_rows_compact(self):
        """返回紧凑格式 {cols: [...], data: [[...]]}，用于 API 传输"""
        try:
            raw = json.loads(self.rows_json) if self.rows_json else {'cols': [], 'data': []}
            if isinstance(raw, dict) and 'cols' in raw:
                return raw
            # 兼容旧格式（对象数组）
            if isinstance(raw, list) and len(raw) > 0:
                cols = list(raw[0].keys())
                return {'cols': cols, 'data': [[r.get(c) for c in cols] for r in raw]}
            return {'cols': [], 'data': []}
        except Exception:
            return {'cols': [], 'data': []}

    def get_rows(self):
        """返回对象数组（解压），兼容旧逻辑"""
        try:
            raw = json.loads(self.rows_json) if self.rows_json else []
            if isinstance(raw, dict) and 'cols' in raw:
                cols = raw['cols']
                return [{cols[i]: r[i] for i in range(len(cols))} for r in raw['data']]
            return raw
        except Exception:
            return []

    def to_dict(self):
        return {
            'id': self.id,
            'report_type': self.report_type,
            'report_name': self.report_name,
            'file_count': self.file_count,
            'row_count': self.row_count,
            'created_at': self.created_at.strftime('%Y-%m-%d %H:%M') if self.created_at else '',
        }
