/**
 * 任务配置API服务器
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { 同步账号配置 } from '../工具/任务配置.js';
import { 同步账号状态 } from '../工具/账号状态.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { adminGetLicenses, adminGenerateLicense, adminUnbindLicense, adminDeleteLicense, getLicenseStatus } from '../工具/internal/security/sys-stat.js';
import { verifyLicense } from '../工具/internal/security/sys-verify.js';
import crypto from 'crypto';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
const HOST = '0.0.0.0'; // 允许外部访问

// 读取配置
const mainConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/config.json'), 'utf-8'));
const configFile = path.join(__dirname, '../data/task-config.json');
const binDir = path.join(__dirname, '../BIN文件');
const hangupConfigFile = path.join(__dirname, '../data/game-hangup-config.json');

const server = http.createServer(async (req, res) => {
  // 设置CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // ✅ 优先处理 OPTIONS 请求
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // ✅ 基础授权API (无需系统授权即可访问，用于激活流程)
  if (req.url === '/api/license/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(await getLicenseStatus()));
    return;
  }

  // ✅ 授权校验 (异步获取，支持dist远程验证)
  const licenseStatus = await getLicenseStatus();
  const isAuthorized = licenseStatus && licenseStatus.authorized;

  // 管理员授权管理接口 (这里简单演示，实际应检查管理员权限)
  if (req.url.startsWith('/api/admin/license/')) {
    const action = req.url.replace('/api/admin/license/', '').split('?')[0];

    if (action === 'list' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, licenses: adminGetLicenses() }));
      return;
    }

    if (action === 'generate' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const result = adminGenerateLicense(JSON.parse(body));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      });
      return;
    }

    if (req.method === 'POST' && action.startsWith('unbind/')) {
      const id = action.replace('unbind/', '');
      const result = adminUnbindLicense(id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    if (req.method === 'DELETE' && action.length > 5) {
      const id = action;
      const result = adminDeleteLicense(id);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }
  }

  if (!isAuthorized) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'SYSTEM_UNAUTHORIZED', message: '请先完成系统授权' }));
    return;
  }

  // 同步账号配置
  if (req.url === '/api/sync-accounts' && req.method === 'POST') {
    try {
      // 同步任务配置
      const configSuccess = 同步账号配置();

      // 同步账号状态（从tokens.json读取账号列表）
      const tokensFile = path.join(__dirname, '../data/tokens.json');
      let statusSuccess = false;
      if (fs.existsSync(tokensFile)) {
        const tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf-8'));
        const accountNames = tokens.map(t => t.name);
        statusSuccess = 同步账号状态(accountNames);
      }

      const success = configSuccess;
      const message = success
        ? (statusSuccess ? '账号配置和状态已同步' : '账号配置已同步（状态无需更新）')
        : '同步失败';

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success,
        message
      }));

      if (success) {
        console.log('[OK] 账号配置已同步');
        if (statusSuccess) {
          console.log('[OK] 账号状态已同步');
        }
      } else {
        console.error('[ERROR] 账号配置同步失败');
      }

    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: error.message }));

      console.error('[ERROR] 同步账号失败:', error.message);
    }

    return;
  }

  // 保存配置
  if (req.url === '/api/save-config' && req.method === 'POST') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const config = JSON.parse(body);
        fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: '配置保存成功' }));

        console.log('[OK] 配置已保存');

      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: error.message }));

        console.error('[ERROR] 保存配置失败:', error.message);
      }
    });

    return;
  }

  // 获取BIN文件列表
  if (req.url === '/api/bin-files' && req.method === 'GET') {
    try {
      if (!fs.existsSync(binDir)) {
        fs.mkdirSync(binDir, { recursive: true });
      }

      const files = fs.readdirSync(binDir)
        .filter(f => f.endsWith('.bin'))
        .map(f => ({
          name: f,
          size: fs.statSync(path.join(binDir, f)).size,
          created: fs.statSync(path.join(binDir, f)).birthtime
        }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, files }));

    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: error.message }));
    }
    return;
  }

  // 上传BIN文件
  if (req.url === '/api/upload-bin' && req.method === 'POST') {
    try {
      const contentType = req.headers['content-type'];
      const boundary = contentType.split('boundary=')[1];

      let chunks = [];

      req.on('data', chunk => {
        chunks.push(chunk);
      });

      req.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);
          const boundaryBuffer = Buffer.from('--' + boundary);

          // 按boundary分割
          let parts = [];
          let start = 0;
          let 循环计数 = 0; // 防止死循环
          const 最大循环次数 = 1000;

          while (start < buffer.length && 循环计数 < 最大循环次数) {
            循环计数++;

            const boundaryIndex = buffer.indexOf(boundaryBuffer, start);
            if (boundaryIndex === -1) break;

            const nextBoundary = buffer.indexOf(boundaryBuffer, boundaryIndex + boundaryBuffer.length);
            if (nextBoundary === -1) break;

            // 防止start不递增
            if (nextBoundary <= boundaryIndex) {
              console.error('[ERROR] boundary解析异常，终止循环');
              break;
            }

            parts.push(buffer.slice(boundaryIndex, nextBoundary));
            start = nextBoundary;
          }

          if (循环计数 >= 最大循环次数) {
            throw new Error('文件上传解析超时，可能存在异常数据');
          }

          for (let part of parts) {
            const partStr = part.toString('utf-8');
            if (partStr.includes('filename=')) {
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

              if (!filename.endsWith('.bin')) {
                throw new Error('只能上传.bin文件');
              }

              // 找到文件内容的起始位置
              const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
              if (headerEnd === -1) continue;

              const fileContent = part.slice(headerEnd + 4, part.length - 2); // 去掉最后的\r\n

              const filePath = path.join(binDir, filename);
              fs.writeFileSync(filePath, fileContent);

              console.log(`[OK] BIN文件已上传: ${filename}`);

              // ✅ 立即返回成功，不等待转换完成
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({
                success: true,
                message: `文件 ${filename} 上传成功，正在后台转换Token...`
              }));

              // 🔄 异步执行Token转换（不阻塞HTTP服务器）
              console.log('[INFO] 开始后台转换Token...');
              const 项目根目录 = path.join(__dirname, '..');
              execAsync(`node "工具/BIN转换/转换BIN.js"`, {
                cwd: 项目根目录,
                timeout: 300000
              })
                .then(() => {
                  console.log('[OK] Token转换完成');

                  // 自动同步账号配置和状态
                  console.log('[INFO] 正在同步账号配置和状态...');
                  const configSuccess = 同步账号配置();
                  const tokensFile = path.join(__dirname, '../data/tokens.json');
                  let statusSuccess = false;
                  if (fs.existsSync(tokensFile)) {
                    const tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf-8'));
                    const accountNames = tokens.map(t => t.name);
                    statusSuccess = 同步账号状态(accountNames);
                  }

                  if (configSuccess) {
                    console.log('[OK] 账号配置已同步');
                  } else {
                    console.warn('[WARN] 账号配置同步失败');
                  }
                  if (statusSuccess) {
                    console.log('[OK] 账号状态已同步');
                  } else {
                    console.log('[INFO] 账号状态无需更新');
                  }
                })
                .catch(err => {
                  console.error('[ERROR] Token转换失败:', err.message);
                });

              return;
            }
          }

          throw new Error('未找到文件内容');

        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, message: error.message }));
          console.error('[ERROR] 上传失败:', error.message);
        }
      });

    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: error.message }));
    }
    return;
  }

  // 删除BIN文件
  if (req.url.startsWith('/api/delete-bin/') && req.method === 'DELETE') {
    const filename = decodeURIComponent(req.url.split('/api/delete-bin/')[1]);
    const filePath = path.join(binDir, filename);

    try {
      if (!fs.existsSync(filePath)) {
        throw new Error('文件不存在');
      }

      fs.unlinkSync(filePath);
      console.log(`[OK] BIN文件已删除: ${filename}`);

      // 自动重新转换所有Token
      console.log('[INFO] 正在重新转换Token...');
      const 项目根目录 = path.join(__dirname, '..');

      execAsync(`node "工具/BIN转换/转换BIN.js"`, {
        cwd: 项目根目录,
        timeout: 300000
      })
        .then(async () => {
          console.log('[OK] Token转换完成');

          // ✅ 自动同步账号配置和状态
          console.log('[INFO] 正在同步账号配置和状态...');
          const configSuccess = 同步账号配置();
          const tokensFile = path.join(__dirname, '../data/tokens.json');
          let statusSuccess = false;
          if (fs.existsSync(tokensFile)) {
            const tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf-8'));
            const accountNames = tokens.map(t => t.name);
            statusSuccess = 同步账号状态(accountNames);
          }

          if (configSuccess) {
            console.log('[OK] 账号配置已同步');
          } else {
            console.warn('[WARN] 账号配置同步失败');
          }
          if (statusSuccess) {
            console.log('[OK] 账号状态已同步');
          } else {
            console.log('[INFO] 账号状态无需更新');
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            message: `文件 ${filename} 已删除，Token已更新，配置已同步`
          }));
        })
        .catch(err => {
          console.error('[ERROR] Token转换失败:', err.message);

          // ✅ 即使Token转换失败，也尝试同步配置（可能只是部分失败）
          try {
            console.log('[INFO] 尝试同步账号配置和状态...');
            const configSuccess = 同步账号配置();
            const tokensFile = path.join(__dirname, '../data/tokens.json');
            let statusSuccess = false;
            if (fs.existsSync(tokensFile)) {
              const tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf-8'));
              const accountNames = tokens.map(t => t.name);
              statusSuccess = 同步账号状态(accountNames);
            }
            if (configSuccess) {
              console.log('[OK] 账号配置已同步');
            }
            if (statusSuccess) {
              console.log('[OK] 账号状态已同步');
            }
          } catch (syncErr) {
            console.error('[ERROR] 同步配置失败:', syncErr.message);
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            message: `文件 ${filename} 已删除，但Token转换失败，已尝试同步配置`
          }));
        });

    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: error.message }));
      console.error('[ERROR] 删除失败:', error.message);
    }
    return;
  }

  // 获取最新日志
  if (req.url === '/api/logs' && req.method === 'GET') {
    try {
      const logsDir = path.join(__dirname, '../logs');

      if (!fs.existsSync(logsDir)) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, logs: '' }));
        return;
      }

      // 获取今天的日志文件
      const now = new Date();
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const logFileName = `${year}-${month}-${day}.log`;
      const logFilePath = path.join(logsDir, logFileName);

      let logs = '';
      if (fs.existsSync(logFilePath)) {
        // 读取最后1000行
        const content = fs.readFileSync(logFilePath, 'utf-8');
        const lines = content.split('\n');
        logs = lines.slice(-1000).join('\n');
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, logs }));

    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: error.message }));
    }
    return;
  }

  // 获取挂机配置
  if (req.url === '/api/hangup-config' && req.method === 'GET') {
    try {
      let config = {};
      if (fs.existsSync(hangupConfigFile)) {
        config = JSON.parse(fs.readFileSync(hangupConfigFile, 'utf-8'));
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, config }));

    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, message: error.message }));
    }
    return;
  }

  // 更新挂机配置
  if (req.url.startsWith('/api/hangup-config/') && (req.method === 'PUT' || req.method === 'POST')) {
    const accountName = decodeURIComponent(req.url.split('/api/hangup-config/')[1]);

    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const { enabled } = JSON.parse(body);

        // 读取现有配置
        let config = {};
        if (fs.existsSync(hangupConfigFile)) {
          config = JSON.parse(fs.readFileSync(hangupConfigFile, 'utf-8'));
        }

        // 更新配置
        config[accountName] = enabled;

        // 保存
        fs.writeFileSync(hangupConfigFile, JSON.stringify(config, null, 2), 'utf-8');

        console.log(`[OK] ${accountName} 挂机${enabled ? '开启' : '关闭'}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: '配置已更新' }));

      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: error.message }));
        console.error('[ERROR] 更新挂机配置失败:', error.message);
      }
    });

    return;
  }

  // 获取挂机状态
  if (req.url === '/api/hangup-status' && req.method === 'GET') {
    try {
      // 读取挂机配置
      let hangupConfig = {};
      if (fs.existsSync(hangupConfigFile)) {
        hangupConfig = JSON.parse(fs.readFileSync(hangupConfigFile, 'utf-8'));
      }

      // 读取窗口状态
      const windowStatusFile = path.join(__dirname, '../插件/游戏自动登录/window-status.json');
      let windowStatus = {};
      if (fs.existsSync(windowStatusFile)) {
        windowStatus = JSON.parse(fs.readFileSync(windowStatusFile, 'utf-8'));
      }

      // 读取调度记录
      const scheduleRecordFile = path.join(__dirname, '../data/task-schedule-record.json');
      let scheduleRecord = {};
      if (fs.existsSync(scheduleRecordFile)) {
        scheduleRecord = JSON.parse(fs.readFileSync(scheduleRecordFile, 'utf-8'));
      }

      // 获取所有BIN文件账号
      const binFiles = fs.readdirSync(binDir)
        .filter(f => f.endsWith('.bin'))
        .map(f => f.replace('.bin', ''));

      // 构建账号状态列表
      const accounts = binFiles.map(accountName => {
        const enabled = hangupConfig[accountName] || false;
        const status = windowStatus[accountName] || {};

        // 获取最近任务时间
        let lastTaskTime = null;
        let lastTaskTimestamp = 0;

        for (const [taskName, taskData] of Object.entries(scheduleRecord)) {
          const accountRecord = taskData?.accounts?.[accountName];
          if (accountRecord?.lastExecutionTime) {
            const execTime = new Date(accountRecord.lastExecutionTime).getTime();
            if (execTime > lastTaskTimestamp) {
              lastTaskTimestamp = execTime;
              const minutesAgo = Math.floor((Date.now() - execTime) / 60000);
              lastTaskTime = `${minutesAgo}分钟前`;
            }
          }
        }

        // 计算等待登录剩余时间
        let waitingLogin = false;
        let waitingMinutes = 0;
        if (status.等待登录时间) {
          const remaining = status.等待登录时间 - Date.now();
          if (remaining > 0) {
            waitingLogin = true;
            waitingMinutes = Math.ceil(remaining / 60000);
          }
        }

        return {
          accountName,
          hangupEnabled: enabled,
          windowExists: status.窗口已打开 || false,
          processId: status.进程ID || null,
          lastTaskTime,
          waitingLogin,
          waitingMinutes
        };
      });

      // 统计数据
      const stats = {
        total: accounts.length,
        enabled: accounts.filter(a => a.hangupEnabled).length,
        online: accounts.filter(a => a.windowExists).length,
        offline: accounts.filter(a => a.hangupEnabled && !a.windowExists && !a.waitingLogin).length
      };

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        data: { accounts, stats }
      }));

    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: error.message }));
      console.error('[ERROR] 获取挂机状态失败:', error.message);
    }
    return;
  }

  // 获取或删除挂机日志
  if (req.url === '/api/hangup-logs') {
    const hangupLogFile = path.join(__dirname, '../插件/游戏自动登录/hangup.log');

    if (req.method === 'GET') {
      try {
        let logs = '';
        if (fs.existsSync(hangupLogFile)) {
          // 读取最后1000行
          const content = fs.readFileSync(hangupLogFile, 'utf-8');
          const lines = content.split('\n');
          logs = lines.slice(-1000).join('\n');
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, logs }));

      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, message: error.message }));
        console.error('[ERROR] 获取挂机日志失败:', error.message);
      }
      return;
    }

    if (req.method === 'DELETE') {
      try {
        if (fs.existsSync(hangupLogFile)) {
          fs.writeFileSync(hangupLogFile, '', 'utf-8');
          console.log('[OK] 挂机日志已清空');
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, message: '日志已清空' }));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, message: error.message }));
        console.error('[ERROR] 清空挂机日志失败:', error.message);
      }
      return;
    }
  }

  // 404
  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, HOST, () => {
  console.log('========================================');
  console.log('  任务配置API服务器已启动');
  console.log(`  监听地址: ${HOST}:${PORT}`);
  console.log(`  本地访问: http://localhost:${PORT}`);
  console.log(`  远程访问: http://[服务器IP]:${PORT}`);
  console.log('========================================');
});
