import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { toolsApi } from './tools-api.js';
import { BossAssistCore } from '../BOSS塔助战/核心逻辑.js';
import { getLicenseStatus, activateLicense } from '../工具/internal/security/sys-stat.js';
import { verifyLicense } from '../工具/internal/security/sys-verify.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(path.dirname(__filename)); // 项目根目录

const PORT = 8080;

// ✅ Session存储（内存版，重启后失效）
const sessions = new Map();

// ✅ BOSS塔助战实例
let bossAssistCore = null;
let bossAssistLogs = [];
const MAX_BOSS_ASSIST_LOGS = 500;
// 存储初始化小号的独立日志
let initLogs = [];
let isInitRunning = false;

function getBossAssistCore() {
  if (!bossAssistCore) {
    bossAssistCore = new BossAssistCore();
    bossAssistCore.onLog = (type, message) => {
      const time = new Date().toLocaleTimeString('zh-CN');
      bossAssistLogs.push({ time, type, message });
      if (bossAssistLogs.length > MAX_BOSS_ASSIST_LOGS) {
        // 使用splice删除前面的日志，保持数组引用不变
        bossAssistLogs.splice(0, bossAssistLogs.length - MAX_BOSS_ASSIST_LOGS);
      }
    };
  }
  return bossAssistCore;
}

// ✅ 读取用户配置
function loadUsers() {
  try {
    const usersFile = path.join(__dirname, 'data/users.json');
    if (fs.existsSync(usersFile)) {
      return JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
    }
  } catch (error) {
    console.error('读取用户配置失败:', error.message);
  }
  return null;
}

// ✅ 验证密码
async function verifyPassword(username, password) {
  const users = loadUsers();
  if (!users || !users[username]) {
    return false;
  }

  try {
    return await bcrypt.compare(password, users[username].password);
  } catch (error) {
    console.error('密码验证失败:', error.message);
    return false;
  }
}

// ✅ 创建Session
function createSession(username, remember = false) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const maxAge = remember ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000; // 30天戒24小时

  sessions.set(sessionId, {
    username,
    createdAt: Date.now(),
    expiresAt: Date.now() + maxAge
  });

  return { sessionId, maxAge };
}

// ✅ 验证Session
function verifySession(sessionId) {
  if (!sessionId) return null;

  const session = sessions.get(sessionId);
  if (!session) return null;

  // 检查是否过期
  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return null;
  }

  return session;
}

// ✅ 从请求头中解析Cookie
function parseCookies(cookieHeader) {
  const cookies = {};
  if (cookieHeader) {
    cookieHeader.split(';').forEach(cookie => {
      const [name, value] = cookie.trim().split('=');
      cookies[name] = value;
    });
  }
  return cookies;
}

// ✅ 读取POST请求体
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  // ✅ 1. 规范化 URL (移除查询参数)
  const url = decodeURIComponent(req.url.split('?')[0]);

  // ✅ 2. 解析 Cookie 中的 SessionId
  const cookies = (req.headers.cookie || '').split(';').reduce((acc, curr) => {
    const [key, ...valueParts] = curr.trim().split('=');
    if (key) acc[key] = valueParts.join('=');
    return acc;
  }, {});
  const sessionId = cookies.sessionId;

  // ✅ 授权API (无需登录验证)
  if (req.url.startsWith('/api/license/')) {
    const action = req.url.replace('/api/license/', '').split('?')[0];

    if (action === 'status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(await getLicenseStatus()));
      return;
    }

    if (action === 'activate' && req.method === 'POST') {
      const { licenseKey } = await readBody(req);
      const result = await activateLicense(licenseKey);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }
  }

  // ✅ 基础资源许可 (仅包含授权及激活所需的最小资源集)
  const isPublicResource =
    url === '/license.html' ||
    url === '/license-admin.html' ||
    url.startsWith('/api/license/') ||
    url.startsWith('/css/') ||
    url.startsWith('/icons/') ||
    url.endsWith('.png') ||
    url.endsWith('.jpg') ||
    url.endsWith('.css') ||
    url.endsWith('.js');

  // ✅ 核心授权拦截 (使用异步远程验证逻辑)
  const licenseStatus = await getLicenseStatus();
  const isAuthorized = licenseStatus && licenseStatus.authorized;

  if (!isAuthorized && !isPublicResource) {
    // 未授权且访问非公开资源，跳转到授权页
    res.writeHead(302, { 'Location': '/license.html' });
    res.end();
    return;
  }

  // ✅ BOSS塔助战API（需要登录验证）
  if (req.url.startsWith('/api/boss-assist/')) {
    const session = verifySession(sessionId);
    if (!session) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '未登录' }));
      return;
    }

    const action = req.url.replace('/api/boss-assist/', '').split('?')[0];
    const core = getBossAssistCore();

    try {
      if (action === 'status' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(core.getStatus()));
        return;
      }

      if (action === 'logs' && req.method === 'GET') {
        const urlParams = new URL(req.url, `http://${req.headers.host}`);
        const since = parseInt(urlParams.searchParams.get('since')) || 0;
        const logs = bossAssistLogs.slice(since);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ logs, total: bossAssistLogs.length }));
        return;
      }

      if (action === 'start' && req.method === 'POST') {
        bossAssistLogs = [];
        const success = await core.start();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success }));
        return;
      }

      if (action === 'stop' && req.method === 'POST') {
        await core.stop();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      if (action === 'init-scouts' && req.method === 'POST') {
        if (isInitRunning) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: '任务正在运行中' }));
          return;
        }

        initLogs = [];
        isInitRunning = true;
        initLogs.push({
          time: new Date().toLocaleTimeString('zh-CN'),
          type: 'info',
          message: '🚀 请求已接收，后台任务正在启动...'
        });

        // 异步执行
        (async () => {
          try {
            const { runInitTask } = await import('../BOSS塔助战/初始化小号.js');
            const logger = (type, message) => {
              initLogs.push({
                time: new Date().toLocaleTimeString('zh-CN'),
                type,
                message
              });
            };
            await runInitTask(logger);
          } catch (e) {
            initLogs.push({
              time: new Date().toLocaleTimeString('zh-CN'),
              type: 'error',
              message: `任务错误: ${e.message}`
            });
          } finally {
            initLogs.push({
              time: new Date().toLocaleTimeString('zh-CN'),
              type: 'info',
              message: '🏁 流程结束'
            });
            setTimeout(() => { isInitRunning = false; }, 2000);
          }
        })();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      if (action === 'init-logs' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ logs: initLogs, running: isInitRunning }));
        return;
      }

      if (action === 'config' && req.method === 'GET') {
        const configPath = path.join(__dirname, 'BOSS塔助战/配置.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(config));
        return;
      }

      if (action === 'config' && req.method === 'POST') {
        const body = await readBody(req);
        const configPath = path.join(__dirname, 'BOSS塔助战/配置.json');
        const currentConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        const newConfig = { ...currentConfig, ...body };
        fs.writeFileSync(configPath, JSON.stringify(newConfig, null, 2), 'utf-8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return;
      }

      if (action === 'masters' && req.method === 'GET') {
        const binDir = path.join(__dirname, 'BOSS塔助战/BIN文件/大号');
        let masters = [];
        if (fs.existsSync(binDir)) {
          const files = fs.readdirSync(binDir);
          masters = files
            .filter(f => f.endsWith('.bin'))
            .map(f => ({ name: f.replace('.bin', ''), file: f }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(masters));
        return;
      }

      if (action === 'scouts' && req.method === 'GET') {
        const binDir = path.join(__dirname, 'BOSS塔助战/BIN文件/小号');
        let scouts = [];
        if (fs.existsSync(binDir)) {
          const files = fs.readdirSync(binDir);
          scouts = files
            .filter(f => f.endsWith('.bin'))
            .map(f => ({ name: f.replace('.bin', ''), file: f }));
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(scouts));
        return;
      }

      if (action === 'upload-bin' && req.method === 'POST') {
        // ✅ 改进的multipart/form-data解析（支持中文文件名）
        const contentType = req.headers['content-type'] || '';
        const boundary = contentType.split('boundary=')[1];
        if (!boundary) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: '无效的请求格式' }));
          return;
        }

        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
          try {
            const buffer = Buffer.concat(chunks);
            const boundaryBuffer = Buffer.from(`--${boundary}`);

            // 提取type参数（从buffer中查找）
            let type = 'scout';
            const typePattern = Buffer.from('name="type"');
            const typeIndex = buffer.indexOf(typePattern);
            if (typeIndex !== -1) {
              const typeStart = buffer.indexOf(Buffer.from('\r\n\r\n'), typeIndex) + 4;
              const typeEnd = buffer.indexOf(Buffer.from('\r\n'), typeStart);
              if (typeStart > 3 && typeEnd > typeStart) {
                type = buffer.slice(typeStart, typeEnd).toString('utf-8').trim();
              }
            }

            const binDir = path.join(__dirname, `BOSS塔助战/BIN文件/${type === 'master' ? '大号' : '小号'}`);

            // 确保目录存在
            if (!fs.existsSync(binDir)) {
              fs.mkdirSync(binDir, { recursive: true });
            }

            // 按boundary分割
            const parts = [];
            let start = 0;
            let loopCount = 0;
            const maxLoops = 1000;

            while (start < buffer.length && loopCount < maxLoops) {
              loopCount++;
              const boundaryIndex = buffer.indexOf(boundaryBuffer, start);
              if (boundaryIndex === -1) break;

              const nextBoundary = buffer.indexOf(boundaryBuffer, boundaryIndex + boundaryBuffer.length);
              if (nextBoundary === -1) break;

              if (nextBoundary <= boundaryIndex) break; // 防止死循环

              parts.push(buffer.slice(boundaryIndex, nextBoundary));
              start = nextBoundary;
            }

            const uploaded = [];

            for (const part of parts) {
              // ✅ 先转成UTF-8字符串（和config-server.js一样）
              const partStr = part.toString('utf-8');

              if (!partStr.includes('filename=')) continue;

              // 使用正则提取文件名，支持中文
              const filenameMatch = partStr.match(/filename="([^"]+)"/);
              if (!filenameMatch) continue;

              let filename = filenameMatch[1];

              // 处理可能的编码问题
              try {
                filename = decodeURIComponent(filename);
              } catch (e) {
                // 如果解码失败，使用原始文件名
              }

              if (!filename.endsWith('.bin')) continue;

              // 找到文件内容的起始位置
              const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
              if (headerEnd === -1) continue;

              const fileContent = part.slice(headerEnd + 4, part.length - 2); // 去掉最后的\r\n

              // 保存文件
              const filePath = path.join(binDir, filename);
              fs.writeFileSync(filePath, fileContent);
              uploaded.push(filename);

              console.log(`[BOSS塔助战] 上传BIN: ${filename} (${fileContent.length} bytes)`);
            }

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, uploaded, count: uploaded.length }));
          } catch (error) {
            console.error('[BOSS塔助战] 上传失败:', error);
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: false, error: error.message }));
          }
        });
        return;
      }

      if (action.startsWith('bin/') && req.method === 'DELETE') {
        const parts = action.replace('bin/', '').split('/');
        if (parts.length !== 2) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: '无效的请求格式' }));
          return;
        }

        const [type, filename] = parts;

        // 安全检查：只允许删除.bin文件
        if (!filename.endsWith('.bin')) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: '只能删除.bin文件' }));
          return;
        }

        const binDir = path.join(__dirname, `BOSS塔助战/BIN文件/${type === 'master' ? '大号' : '小号'}`);
        const filePath = path.join(binDir, filename);

        // 检查文件是否存在
        if (!fs.existsSync(filePath)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: '文件不存在' }));
          return;
        }

        // 删除文件
        fs.unlinkSync(filePath);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: `已删除 ${filename}` }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '未知操作' }));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // ✅ 处理登录接口
  if (req.url === '/api/login' && req.method === 'POST') {
    try {
      const { username, password, remember } = await readBody(req);

      // 验证密码
      const isValid = await verifyPassword(username, password);

      if (isValid) {
        // 创建Session
        const { sessionId, maxAge } = createSession(username, remember);

        // 设置Cookie
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': `sessionId=${sessionId}; Max-Age=${Math.floor(maxAge / 1000)}; Path=/; HttpOnly; SameSite=Strict`
        });
        res.end(JSON.stringify({ success: true, redirect: '/account-status.html' }));

        console.log(`✅ 用户 [${username}] 登录成功`);
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '用户名或密码错误' }));
      }
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '服务器错误' }));
    }
    return;
  }

  // ✅ 工具箱API
  if (req.url.startsWith('/api/tools/') && req.method === 'POST') {
    // 验证登录状态
    const session = verifySession(sessionId);
    if (!session) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '未登录' }));
      return;
    }

    try {
      const body = await readBody(req);
      const action = req.url.replace('/api/tools/', '');

      let result;
      switch (action) {
        case 'connect':
          result = await toolsApi.connect(body.accountName);
          break;
        case 'disconnect':
          result = toolsApi.disconnect(body.accountName);
          break;
        case 'getroleinfo':
          result = await toolsApi.getroleinfo(body.accountName);
          break;
        case 'openbox':
          result = await toolsApi.openbox(body.accountName, body.boxType, body.count);
          break;
        case 'claimboxpoints':
          result = await toolsApi.claimboxpoints(body.accountName);
          break;
        case 'fish':
          result = await toolsApi.fish(body.accountName, body.fishType, body.count);
          break;
        case 'recruit':
          result = await toolsApi.recruit(body.accountName, body.recruitType, body.count);
          break;
        // 升星相关
        case 'heroupgradestar':
          result = await toolsApi.heroupgradestar(body.accountName, body.delay);
          break;
        case 'bookupgrade':
          result = await toolsApi.bookupgrade(body.accountName, body.delay);
          break;
        case 'claimbookreward':
          result = await toolsApi.claimbookreward(body.accountName);
          break;
        // 消耗活动
        case 'openactivityitem':
          result = await toolsApi.openactivityitem(body.accountName, body.count);
          break;
        case 'getactivityinfo':
          result = await toolsApi.getactivityinfo(body.accountName);
          break;
        // 武将升级
        case 'heroupgradelevel':
          result = await toolsApi.heroupgradelevel(body.accountName, body.heroId, body.upgradeNum);
          break;
        case 'heroupgradeorder':
          result = await toolsApi.heroupgradeorder(body.accountName, body.heroId);
          break;
        // 竞技场
        case 'arenafight':
          result = await toolsApi.arenafight(body.accountName, body.count);
          break;
        default:
          result = { success: false, error: '未知操作' };
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  // ✅ 处理登出接口
  if (req.url === '/api/logout') {
    if (sessionId) {
      sessions.delete(sessionId);
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': 'sessionId=; Max-Age=0; Path=/'
    });
    res.end(JSON.stringify({ success: true }));
    return;
  }

  // ✅ 检查是否已配置用户
  const users = loadUsers();
  const hasUsers = users && Object.keys(users).length > 0;

  // ✅ 如果未配置用户，显示提示页
  if (!hasUsers && req.url !== '/login.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>首次使用</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #f5f5f5; }
          .box { background: white; padding: 40px; border-radius: 10px; max-width: 600px; margin: 0 auto; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          h1 { color: #333; }
          pre { background: #f0f0f0; padding: 15px; border-radius: 5px; text-align: left; }
          .step { margin: 20px 0; text-align: left; }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>🔒 首次使用，请设置密码</h1>
          <div class="step">
            <h3>步骤1：运行以下命令</h3>
            <pre>node 工具/设置密码.js</pre>
          </div>
          <div class="step">
            <h3>步骤2：按提示输入用户名和密码</h3>
          </div>
          <div class="step">
            <h3>步骤3：重启服务</h3>
            <pre>按 Ctrl+C 停止当前服务，然后重新启动</pre>
          </div>
          <p style="color: #666; margin-top: 30px;">设置完成后刷新此页面</p>
        </div>
      </body>
      </html>
    `);
    return;
  }

  // ✅ 授权页面和管理页面(只要是公开资源且匹配文件名，直接返回)
  if (url === '/license.html' || url === '/license-admin.html') {
    const filePath = path.join(__dirname, 'web', path.basename(url));
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content);
      return;
    }
  }

  // ✅ 登录页面不需要验证
  if (url === '/login.html' || url === '/') {
    // 如果已登录访问根路径，重定向到账号状态页
    if (url === '/' && verifySession(sessionId)) {
      res.writeHead(302, { 'Location': '/account-status.html' });
      res.end();
      return;
    }

    // 显示登录页
    const filePath = path.join(__dirname, 'web/login.html');
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(content);
    return;
  }

  // ✅ 验证Session (其他所有非公开页面都需要登录)
  const session = verifySession(sessionId);
  if (!session) {
    // 未登录，重定向到登录页
    res.writeHead(302, { 'Location': '/login.html' });
    res.end();
    return;
  }

  // ✅ 已登录，处理静态文件请求
  let filePath = '.' + url;
  if (filePath === './') {
    filePath = './web/account-status.html';
  }

  // 如果请求的是HTML文件，从web文件夹读取
  if (path.extname(filePath) === '.html') {
    // 如果路径不包含web/，添加web/前缀
    if (!filePath.includes('/web/')) {
      filePath = './web/' + path.basename(filePath);
    }
  }

  // 如果请求的是CSS文件，从web文件夹读取
  if (filePath.startsWith('./css/')) {
    filePath = './web' + filePath.substring(1);
  }

  // 如果请求的是icons文件，从web文件夹读取
  if (filePath.startsWith('./icons/')) {
    filePath = './web' + filePath.substring(1);
  }

  // 如果是/data/开头的路径（API请求JSON文件）
  // 保持原样，因为filePath已经是./data/...

  // 如果是/BIN文件/开头的路径
  if (filePath.startsWith('./BIN文件/') || filePath.startsWith('./BIN%E6%96%87%E4%BB%B6/')) {
    filePath = filePath.replace('./BIN%E6%96%87%E4%BB%B6/', './BIN文件/');
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const contentType = mimeTypes[extname] || 'application/octet-stream';

  const fullPath = path.join(__dirname, filePath);

  fs.readFile(fullPath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 - File Not Found</h1>', 'utf-8');
      } else {
        res.writeHead(500);
        res.end('Server Error: ' + error.code, 'utf-8');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`静态服务器运行在 http://localhost:${PORT}/`);
  console.log(`远程访问地址: http://0.0.0.0:${PORT}/`);
});
