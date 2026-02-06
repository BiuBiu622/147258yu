import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { adminGetLicenses, adminGenerateLicense, adminUnbindLicense, adminDeleteLicense, getLicenseStatus } from '../../工具/internal/security/sys-stat.js';
import { verifyCredentials, createSession, verifySession, destroySession } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 3100;

// MIME 类型
const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml'
};

/**
 * 从请求头中提取 Session Token
 */
function getSessionToken(req) {
    const cookie = req.headers.cookie;
    if (!cookie) return null;

    const match = cookie.match(/session=([^;]+)/);
    return match ? match[1] : null;
}

/**
 * 验证是否已登录
 */
function requireAuth(req, res) {
    const token = getSessionToken(req);
    if (!token) {
        return { authorized: false };
    }

    const sessionCheck = verifySession(token);
    if (!sessionCheck.valid) {
        return { authorized: false };
    }

    return { authorized: true, username: sessionCheck.username };
}

const server = http.createServer(async (req, res) => {
    // 设置 CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cookie');
    res.setHeader('Access-Control-Allow-Credentials', 'true');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = decodeURIComponent(req.url.split('?')[0]);

    // ✅ 0. 登录 API（无需认证）
    if (url === '/api/auth/login' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const { username, password } = JSON.parse(body);
                const authResult = verifyCredentials(username, password);

                if (!authResult.success) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(authResult));
                    return;
                }

                const { token, expiresAt } = createSession(authResult.username);
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Set-Cookie': `session=${token}; HttpOnly; Path=/; Max-Age=1800; SameSite=Lax`
                });
                res.end(JSON.stringify({ success: true, username: authResult.username, expiresAt }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: '请求格式错误' }));
            }
        });
        return;
    }

    // ✅ 1. 公开的激活 API（最顶层处理，确保不被拦截）
    if (url.includes('/api/admin/license/activate') && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const { licenseKey, machineId } = JSON.parse(body);
                console.log(`[激活请求] 授权码: ${licenseKey?.substring(0, 16)}..., 机器码: ${machineId}`);

                if (!licenseKey || !machineId) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'MISSING_PARAMS' }));
                    return;
                }

                // 读取数据库
                const dataFile = path.join(__dirname, '../数据/all_licenses.json');
                if (!fs.existsSync(dataFile)) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'DATABASE_NOT_FOUND' }));
                    return;
                }

                let all = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
                const key = licenseKey.trim().toUpperCase();
                const index = all.findIndex(l => (l.licenseKey === key || l.licenseKey.toUpperCase() === key));

                if (index === -1) {
                    console.log(`[激活请求] 授权码未找到`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'LICENSE_NOT_FOUND' }));
                    return;
                }

                const license = all[index];
                console.log(`[激活请求] 找到授权码，状态: ${license.status}, 已绑定: ${license.machineId || '无'}`);

                // 检查是否可以激活
                if (license.machineId && license.status !== 'unbound' && license.machineId !== machineId) {
                    console.log(`[激活请求] 已绑定到其他设备`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'ALREADY_BOUND_TO_OTHER_DEVICE' }));
                    return;
                }

                // 激活成功，更新数据库
                all[index].machineId = machineId;
                all[index].status = 'active';
                all[index].activatedAt = new Date().toISOString();
                fs.writeFileSync(dataFile, JSON.stringify(all, null, 2), 'utf-8');

                console.log(`[激活请求] 激活成功`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    type: license.type,
                    expiresAt: license.expiresAt
                }));
            } catch (e) {
                console.error('[激活请求] 错误:', e.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: e.message }));
            }
        });
        return;
    }

    // ✅ 2. 管理端 API 路由（需要认证）
    if (url.startsWith('/api/admin/license/')) {
        const auth = requireAuth(req, res);
        if (!auth.authorized) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: '未登录' }));
            return;
        }

        const action = url.replace('/api/admin/license/', '');

        if (action === 'list' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, licenses: adminGetLicenses() }));
            return;
        }

        if (action === 'generate' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                try {
                    const result = adminGenerateLicense(JSON.parse(body));
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));
                } catch (e) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: e.message }));
                }
            });
            return;
        }

        if (action.startsWith('unbind/') && req.method === 'POST') {
            const id = action.replace('unbind/', '');
            const result = adminUnbindLicense(id);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
            return;
        }

        if (req.method === 'DELETE') {
            const id = action;
            const result = adminDeleteLicense(id);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
            return;
        }
    }

    // ✅ 3. 登录状态/退出 API
    if (url === '/api/auth/logout' && req.method === 'POST') {
        const token = getSessionToken(req);
        if (token) destroySession(token);
        res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'session=; HttpOnly; Path=/; Max-Age=0' });
        res.end(JSON.stringify({ success: true }));
        return;
    }

    if (url === '/api/auth/check' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(requireAuth(req, res)));
        return;
    }

    // ✅ 4. 授权验证 API（供客户端验证本地 license.dat）
    if (url === '/api/license/verify' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const { licenseKey, machineId } = JSON.parse(body);
                const dataFile = path.join(__dirname, '../数据/all_licenses.json');
                if (!fs.existsSync(dataFile)) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'DATABASE_NOT_FOUND' }));
                    return;
                }

                let all = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
                const key = licenseKey.trim().toUpperCase();
                const record = all.find(l => (l.licenseKey === key || l.licenseKey.toUpperCase() === key));

                if (!record) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ authorized: false, error: 'LICENSE_NOT_FOUND' }));
                    return;
                }

                // 验证机器码匹配
                if (record.machineId && record.machineId !== machineId) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ authorized: false, error: 'MACHINE_MISMATCH' }));
                    return;
                }

                // 验证状态
                if (record.status !== 'active') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ authorized: false, error: 'LICENSE_INACTIVE' }));
                    return;
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    authorized: true,
                    type: record.type,
                    expiresAt: record.expiresAt,
                    activatedAt: record.activatedAt
                }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: '请求格式错误' }));
            }
        });
        return;
    }

    // ✅ 5. 基础状态 API（无需认证）
    if (url === '/api/license/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(getLicenseStatus()));
        return;
    }

    // ✅ 5. 静态文件服务
    let filePath = path.join(__dirname, url === '/' ? 'index.html' : url);
    if (url === '/login.html' || url === '/login') filePath = path.join(__dirname, 'login.html');

    if (url === '/' && !fs.existsSync(filePath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<h1>授权管理端已启动</h1><p>请确保 index.html 已就绪。</p>');
        return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
        fs.createReadStream(filePath).pipe(res);
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`========================================`);
    console.log(`  独立授权管理端服务器已启动`);
    console.log(`  监听端口: ${PORT}`);
    console.log(`  默认账号: qq1163461609`);
    console.log(`========================================`);
});
