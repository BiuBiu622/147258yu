/**
 * 动态获取 BattleVersion
 * 方法1: 通过 /login/manifest 接口获取（HTTP）
 * 方法2: 通过 fight_startlevel 命令获取（WebSocket，需要已连接）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { bon, getEnc } from './BON协议.js';
import { 信息日志, 成功日志, 错误日志, 警告日志 } from './日志工具.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const lx = getEnc('lx');

// 文件缓存路径（放在竞技场目录下，因为只有竞技场任务用到）
const CACHE_FILE = path.join(__dirname, '../任务/竞技场/battle-version-cache.json');
const CACHE_DURATION = 4 * 60 * 60 * 1000; // 缓存4小时

// 内存缓存（避免同一进程内重复读文件）
let memoryCache = null;

/**
 * 读取文件缓存
 */
function 读取缓存() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      if (data.version && data.time && (Date.now() - data.time < CACHE_DURATION)) {
        return data;
      }
    }
  } catch (e) {
    // 缓存文件损坏，忽略
  }
  return null;
}

/**
 * 写入文件缓存
 */
function 写入缓存(version) {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify({
      version,
      time: Date.now(),
      updateAt: new Date().toISOString()
    }, null, 2));
  } catch (e) {
    警告日志(`写入版本缓存失败: ${e.message}`);
  }
}

/**
 * 通过WebSocket客户端获取战斗版本（需要已连接的client）
 * @param {WebSocketClient} client - 已连接的WebSocket客户端
 * @returns {Promise<number|null>} battleVersion
 */
export async function 通过WebSocket获取战斗版本(client) {
  if (!client || !client.isConnected || !client.isConnected()) {
    return null;
  }
  
  return new Promise((resolve) => {
    let resolved = false;
    
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        client.off('message', messageHandler);
        resolve(null);
      }
    }, 5000);
    
    const messageHandler = (message) => {
      if (message.cmd && message.cmd.toLowerCase().includes('startlevel')) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          client.off('message', messageHandler);
          
          // 解析body
          let body = message.body;
          if (body instanceof Uint8Array) {
            body = bon.decode(body);
          } else if (body && typeof body === 'object' && !body.battleData) {
            const keys = Object.keys(body).map(k => parseInt(k)).sort((a, b) => a - b);
            if (keys.length > 0 && keys[0] === 0) {
              const arr = new Uint8Array(keys.length);
              keys.forEach((k, i) => arr[i] = body[k]);
              body = bon.decode(arr);
            }
          }
          
          const version = body?.battleData?.version;
          if (version) {
            成功日志(`通过WebSocket获取战斗版本: ${version}`);
            // 更新缓存
            memoryCache = { version, time: Date.now() };
            写入缓存(version);
            resolve(version);
          } else {
            resolve(null);
          }
        }
      }
    };
    
    client.on('message', messageHandler);
    client.send('fight_startlevel', {});
  });
}

/**
 * 获取最新的 battleVersion
 * @param {string} host - 游戏服务器地址
 * @param {boolean} forceRefresh - 是否强制刷新缓存
 * @returns {Promise<number>} battleVersion
 */
export async function 获取战斗版本(host = 'https://game.h5.hortor.com', forceRefresh = false) {
  // 检查内存缓存
  if (!forceRefresh && memoryCache && (Date.now() - memoryCache.time < CACHE_DURATION)) {
    信息日志(`使用内存缓存的战斗版本: ${memoryCache.version}`);
    return memoryCache.version;
  }
  
  // 检查文件缓存
  if (!forceRefresh) {
    const fileCache = 读取缓存();
    if (fileCache) {
      memoryCache = fileCache;
      信息日志(`使用文件缓存的战斗版本: ${fileCache.version}`);
      return fileCache.version;
    }
  }

  const url = `${host}/login/manifest`;
  
  try {
    信息日志('正在获取最新战斗版本...');
    
    // 构造请求体
    const requestBody = {
      version: '1.65.3-wx',
      platform: 'hortor'
    };
    
    // BON 编码 + LX 加密
    const encoded = bon.encode(requestBody);
    const encrypted = lx.encrypt(encoded);
    
    // 发送请求
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'O4e-Encoding': 'LX'
      },
      body: encrypted
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    // 读取响应
    const responseBuffer = await response.arrayBuffer();
    const responseBytes = new Uint8Array(responseBuffer);
    
    // LX 解密 + BON 解码
    const decrypted = lx.decrypt(responseBytes);
    const manifest = bon.decode(decrypted);
    
    // 解析 body
    let body = manifest.body;
    if (body instanceof Uint8Array) {
      body = bon.decode(body);
    } else if (body && typeof body === 'object' && !body.battleVersion) {
      // body 可能是数字数组对象，转换为 Uint8Array 再解码
      const keys = Object.keys(body).map(k => parseInt(k)).sort((a, b) => a - b);
      if (keys.length > 0 && keys[0] === 0) {
        const arr = new Uint8Array(keys.length);
        keys.forEach((k, i) => arr[i] = body[k]);
        body = bon.decode(arr);
      }
    }
    
    if (body && body.battleVersion) {
      // 更新内存缓存和文件缓存
      memoryCache = { version: body.battleVersion, time: Date.now() };
      写入缓存(body.battleVersion);
      成功日志(`获取战斗版本成功: ${body.battleVersion}`);
      return body.battleVersion;
    } else {
      throw new Error('响应中未找到 battleVersion 字段');
    }
    
  } catch (error) {
    错误日志(`获取战斗版本失败: ${error.message}`);
    
    // 如果有内存缓存，返回缓存值
    if (memoryCache) {
      警告日志(`使用过期内存缓存: ${memoryCache.version}`);
      return memoryCache.version;
    }
    
    // 尝试读取过期的文件缓存
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
        if (data.version) {
          警告日志(`使用过期文件缓存: ${data.version}`);
          return data.version;
        }
      }
    } catch (e) {
      // 忽略
    }
    
    // 返回默认值
    警告日志('使用默认战斗版本: 240477');
    return 240477;
  }
}

// 导出别名
export const getBattleVersion = 获取战斗版本;
export const getVersionViaWebSocket = 通过WebSocket获取战斗版本;
