"""
企业运营分析平台 — 极简后端

职责：
  - 用户注册/登录/登出
  - 报告存储/列表/加载/删除
  - 管理员面板（用户管理、模块权限）
  - 数据不上传——Excel 永远在浏览器处理
"""
import os
import json
import uuid
from functools import wraps

from flask import Flask, request, jsonify, send_from_directory
from flask_login import LoginManager, login_user, logout_user, login_required, current_user

from config import DevelopmentConfig, ProductionConfig
from models import db, bcrypt, User, Report, MODULES, MODULE_IDS, DEFAULT_MODULES


# ---- 生产环境安全检查 ----
def _check_production_secrets(app):
    if app.config.get('DEBUG'):
        return
    secret = app.config.get('SECRET_KEY', '')
    if not secret or 'change-me' in secret.lower() or 'dev-secret' in secret.lower() or len(secret) < 16:
        print('=' * 60)
        print('[致命错误] 生产环境必须设置 SECRET_KEY 环境变量（长度≥16）')
        print('生成: python -c "import secrets; print(secrets.token_urlsafe(32))"')
        print('=' * 60)
        import sys
        sys.exit(1)


def create_app(config=None):
    app = Flask(__name__, static_folder='../js', static_url_path='/js')
    if config is None:
        env = os.environ.get('FLASK_ENV', 'development')
        config = ProductionConfig if env == 'production' else DevelopmentConfig
    app.config.from_object(config)

    _check_production_secrets(app)

    db.init_app(app)
    bcrypt.init_app(app)

    # ---- Login Manager ----
    login_manager = LoginManager()
    login_manager.login_view = '/api/unauthorized'
    login_manager.init_app(app)

    @login_manager.user_loader
    def load_user(user_id):
        return User.query.get(int(user_id))

    # ---- 静态文件 ----
    @app.route('/')
    def index():
        return send_from_directory('..', 'index.html')

    @app.route('/dashboard.html')
    def dashboard():
        return send_from_directory('..', 'dashboard.html')

    @app.route('/<path:path>')
    def static_files(path):
        return send_from_directory('..', path)

    # ---- 禁止缓存 HTML（开发阶段每次刷新拿到最新代码）----
    @app.after_request
    def _no_cache_html(response):
        if response.content_type and 'text/html' in response.content_type:
            response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
            response.headers['Pragma'] = 'no-cache'
            response.headers['Expires'] = '0'
        return response

    # ================================================================
    # 认证 API
    # ================================================================

    @app.route('/api/unauthorized')
    def api_unauthorized():
        return jsonify({'error': '请先登录'}), 401

    @app.route('/api/auth/register', methods=['POST'])
    def api_register():
        data = request.get_json() or {}
        email = (data.get('email') or '').strip().lower()
        password = data.get('password', '')

        if not email or '@' not in email:
            return jsonify({'error': '请输入有效的邮箱地址'}), 400
        if len(password) < 6:
            return jsonify({'error': '密码至少 6 位'}), 400
        if User.query.filter_by(email=email).first():
            return jsonify({'error': '该邮箱已注册'}), 409

        user = User(email=email, enabled_modules=DEFAULT_MODULES)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()

        login_user(user)
        return jsonify({'ok': True, 'user': user.to_dict()})

    @app.route('/api/auth/login', methods=['POST'])
    def api_login():
        data = request.get_json() or {}
        email = (data.get('email') or '').strip().lower()
        password = data.get('password', '')

        user = User.query.filter_by(email=email).first()
        if not user or not user.check_password(password):
            return jsonify({'error': '邮箱或密码错误'}), 401
        if user.status == 'disabled':
            return jsonify({'error': '账号已被禁用，请联系管理员'}), 403

        login_user(user, remember=data.get('remember', False))
        return jsonify({'ok': True, 'user': user.to_dict()})

    @app.route('/api/auth/logout', methods=['POST'])
    @login_required
    def api_logout():
        logout_user()
        return jsonify({'ok': True})

    @app.route('/api/auth/me')
    def api_me():
        if current_user.is_authenticated:
            return jsonify({'user': current_user.to_dict()})
        return jsonify({'user': None})

    # ================================================================
    # 报告 API
    # ================================================================

    @app.route('/api/reports', methods=['GET'])
    @login_required
    def api_reports():
        """获取当前用户的报告列表"""
        reports = Report.query.filter_by(user_id=current_user.id)\
            .order_by(Report.created_at.desc()).limit(50).all()
        return jsonify([r.to_dict() for r in reports])

    @app.route('/api/reports/<report_id>', methods=['GET'])
    @login_required
    def api_report_detail(report_id):
        """获取单份报告完整数据"""
        r = Report.query.filter_by(id=report_id, user_id=current_user.id).first()
        if not r:
            return jsonify({'error': '报告不存在'}), 404
        return jsonify({
            'id': r.id,
            'report_type': r.report_type,
            'report_name': r.report_name,
            'DATA': r.get_data(),
            'detailRows': r.get_rows(),
            'file_count': r.file_count,
            'row_count': r.row_count,
            'created_at': r.created_at.strftime('%Y-%m-%d %H:%M') if r.created_at else '',
        })

    @app.route('/api/reports/save', methods=['POST'])
    @login_required
    def api_report_save():
        """保存报告到服务器"""
        can, msg = current_user.can_create_report()
        if not can:
            return jsonify({'error': msg}), 403

        data = request.get_json() or {}
        DATA = data.get('DATA')
        detail_rows = data.get('detailRows')
        report_type = data.get('reportType', 'expense')
        file_names = data.get('fileNames', ['未知文件'])
        existing_id = data.get('id')  # 更新已有报告

        if not DATA or not detail_rows:
            return jsonify({'error': '缺少报告数据'}), 400

        report_id = existing_id or uuid.uuid4().hex[:12]

        if existing_id:
            r = Report.query.filter_by(id=existing_id, user_id=current_user.id).first()
            if not r:
                return jsonify({'error': '报告不存在'}), 404
        else:
            r = Report(id=report_id, user_id=current_user.id)
            current_user.reports_used += 1

        r.report_type = report_type
        r.report_name = ', '.join(file_names) if isinstance(file_names, list) else str(file_names)
        r.file_count = len(file_names) if isinstance(file_names, list) else 1
        r.row_count = len(detail_rows)
        r.set_data(DATA, detail_rows)
        db.session.add(r)
        db.session.commit()

        return jsonify({'ok': True, 'id': report_id})

    @app.route('/api/reports/<report_id>', methods=['DELETE'])
    @login_required
    def api_report_delete(report_id):
        """删除报告"""
        r = Report.query.filter_by(id=report_id, user_id=current_user.id).first()
        if not r:
            return jsonify({'error': '报告不存在'}), 404
        db.session.delete(r)
        db.session.commit()
        return jsonify({'ok': True})

    # ================================================================
    # 大文件服务端处理（>50MB，仅内部使用）
    # ================================================================

    @app.route('/api/upload-large', methods=['POST'])
    @login_required
    def api_upload_large():
        """服务端处理超大 Excel 文件（商用版不启用此接口）"""
        can, msg = current_user.can_create_report()
        if not can:
            return jsonify({'error': msg}), 403

        file = request.files.get('file')
        if not file:
            return jsonify({'error': '未选择文件'}), 400

        ext = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else ''
        if ext not in ('xlsx', 'xls'):
            return jsonify({'error': '仅支持 .xlsx / .xls 格式'}), 400

        module_type = request.form.get('module', 'expense')
        user_mapping_json = request.form.get('mapping', '{}')
        try:
            user_mapping = json.loads(user_mapping_json)
        except Exception:
            user_mapping = {}

        import tempfile
        tmp = tempfile.NamedTemporaryFile(suffix='.' + ext, delete=False)
        tmp_path = tmp.name
        file.save(tmp_path)
        tmp.close()

        try:
            import pandas as pd
            from shared.column_detector import detect_columns
            from shared.excel_reader import pd_read_excel

            df = pd_read_excel(tmp_path)

            if module_type == 'sales':
                from modules.sales.column_defs import SALES_COLUMN_DEFS
                from modules.sales.processor import process_dataframe, validate_and_clean_data
                col_defs = SALES_COLUMN_DEFS
            else:
                from modules.expense.column_defs import COLUMN_DEFS
                from modules.expense.processor import process_dataframe, validate_and_clean_data
                col_defs = COLUMN_DEFS

            # Column detection
            mapping, confidence, details, unmatched = detect_columns(df, col_defs)

            # Apply user mapping overrides
            for fk, col in user_mapping.items():
                if col and col in df.columns:
                    mapping[fk] = col

            # Rename columns
            rename_map = {v: k for k, v in mapping.items() if v and v in df.columns}
            df = df.rename(columns=rename_map)

            # Validate & process
            df, warnings = validate_and_clean_data(df)
            DATA, detail_rows = process_dataframe(df)

            from shared.encoder import NpEncoder
            DATA = json.loads(json.dumps(DATA, ensure_ascii=False, cls=NpEncoder))
            detail_rows = json.loads(json.dumps(detail_rows, ensure_ascii=False, cls=NpEncoder))

            return jsonify({
                'ok': True,
                'DATA': DATA,
                'detailRows': detail_rows,
                'mapping': mapping,
                'warnings': warnings or [],
                'unmatched': unmatched or [],
            })
        except Exception as e:
            import traceback
            traceback.print_exc()
            return jsonify({'error': '处理失败: ' + str(e)}), 500
        finally:
            try:
                os.remove(tmp_path)
            except Exception:
                pass

    # ================================================================
    # 管理员 API
    # ================================================================

    def require_admin(fn):
        @wraps(fn)
        @login_required
        def wrapper(*a, **kw):
            if not current_user.is_admin():
                return jsonify({'error': '需要管理员权限'}), 403
            return fn(*a, **kw)
        return wrapper

    @app.route('/api/admin/users')
    @require_admin
    def api_admin_users():
        users = User.query.order_by(User.created_at.desc()).all()
        return jsonify([u.to_dict() for u in users])

    @app.route('/api/admin/user/<int:user_id>', methods=['POST'])
    @require_admin
    def api_admin_update_user(user_id):
        u = User.query.get(user_id)
        if not u:
            return jsonify({'error': '用户不存在'}), 404

        data = request.get_json() or {}
        if 'status' in data:
            u.status = data['status']
        if 'role' in data and data['role'] in ('user', 'admin'):
            u.role = data['role']
        if 'max_reports' in data:
            u.max_reports = int(data['max_reports'])
        if 'enabled_modules' in data:
            mods = data['enabled_modules']
            if mods == 'ALL':
                u.enabled_modules = json.dumps(MODULE_IDS)
            elif isinstance(mods, list):
                u.enabled_modules = json.dumps([m for m in mods if m in MODULE_IDS])
        db.session.commit()
        return jsonify({'ok': True, 'user': u.to_dict()})

    # ================================================================
    # 启动
    # ================================================================
    with app.app_context():
        db.create_all()
        # 创建默认管理员
        admin_email = os.environ.get('ADMIN_EMAIL', 'admin@example.com')
        if not User.query.filter_by(email=admin_email).first():
            admin = User(
                email=admin_email,
                role='admin',
                max_reports=-1,
                enabled_modules=json.dumps(['ALL']),
            )
            admin.set_password(os.environ.get('ADMIN_PASSWORD', 'admin123'))
            db.session.add(admin)
            db.session.commit()
            print(f'[Init] 管理员已创建: {admin_email}')

    return app


if __name__ == '__main__':
    app = create_app()
    print(f'  访问: http://localhost:5000')
    app.run(debug=True, host='0.0.0.0', port=5000)
