/**
 * 认证模块 — Flask 后端 API
 *
 * 后端端点：
 *   POST /api/auth/register  → { email, password }
 *   POST /api/auth/login     → { email, password }
 *   POST /api/auth/logout    → 需登录
 *   GET  /api/auth/me        → { user: {...} | null }
 */

// ---- 内部请求 ----

async function _api(method, path, body) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
    };
    if (body) opts.body = JSON.stringify(body);

    const resp = await fetch(API_BASE + path, opts);
    const data = await resp.json();

    if (!resp.ok) {
        return { error: data.error || `请求失败 (${resp.status})` };
    }
    return data;
}

// ---- 公开 API ----

/**
 * 注册
 */
async function signUp(email, password) {
    return _api('POST', '/api/auth/register', { email, password });
}

/**
 * 登录
 */
async function signIn(email, password) {
    return _api('POST', '/api/auth/login', { email, password });
}

/**
 * 登出
 */
async function signOut() {
    return _api('POST', '/api/auth/logout');
}

/**
 * 获取当前用户，未登录返回 null
 */
async function getCurrentUser() {
    const data = await _api('GET', '/api/auth/me');
    return data.user || null;
}

/**
 * 获取当前会话（简化：同 getCurrentUser）
 */
async function getSession() {
    const user = await getCurrentUser();
    return user ? { user } : null;
}

/**
 * 重置密码（暂未实现后端，占位）
 */
async function resetPassword(email) {
    return { error: '请联系管理员重置密码' };
}

/**
 * 监听认证变化（简化：轮询不支持，页面刷新后自动检测）
 */
function onAuthChange(callback) {
    // Flask-Login 使用 cookie，无需实时监听
    // 页面加载时 checkAuth() 自动处理
}
