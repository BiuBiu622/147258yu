import crypto from 'crypto';

// 简单的用户数据库（生产环境应使用真实数据库）
const users = {
    'qq1163461609': {
        username: 'qq1163461609',
        // 密码: qq1163461609 的 bcrypt 哈希
        // 使用简化版本：SHA256(密码 + salt)
        passwordHash: crypto.createHash('sha256').update('qq1163461609' + 'SALT_2026').digest('hex')
    }
};

// Session 存储（生产环境应使用 Redis 等）
const sessions = new Map();
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30分钟

/**
 * 验证用户凭证
 */
export function verifyCredentials(username, password) {
    const user = users[username];
    if (!user) {
        return { success: false, error: '用户名或密码错误' };
    }

    const passwordHash = crypto.createHash('sha256').update(password + 'SALT_2026').digest('hex');
    if (passwordHash !== user.passwordHash) {
        return { success: false, error: '用户名或密码错误' };
    }

    return { success: true, username: user.username };
}

/**
 * 创建 Session
 */
export function createSession(username) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + SESSION_TIMEOUT;

    sessions.set(token, {
        username,
        expiresAt
    });

    return { token, expiresAt };
}

/**
 * 验证 Session
 */
export function verifySession(token) {
    const session = sessions.get(token);

    if (!session) {
        return { valid: false, error: '未登录' };
    }

    if (Date.now() > session.expiresAt) {
        sessions.delete(token);
        return { valid: false, error: 'Session已过期' };
    }

    // 刷新过期时间
    session.expiresAt = Date.now() + SESSION_TIMEOUT;

    return { valid: true, username: session.username };
}

/**
 * 销毁 Session
 */
export function destroySession(token) {
    sessions.delete(token);
    return { success: true };
}

/**
 * 清理过期 Session（定时任务）
 */
export function cleanupExpiredSessions() {
    const now = Date.now();
    for (const [token, session] of sessions.entries()) {
        if (now > session.expiresAt) {
            sessions.delete(token);
        }
    }
}

// 每5分钟清理一次过期Session
setInterval(cleanupExpiredSessions, 5 * 60 * 1000);
