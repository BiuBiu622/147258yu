/**
 * BIN文件转Token工具
 * 使用方法: node 工具/BIN转换/转换BIN.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { bon } from '../BON协议.js';
import { 成功日志, 错误日志, 信息日志 } from '../日志工具.js';
import { 同步账号配置 } from '../任务配置.js';
import { 同步账号状态 } from '../账号状态.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取配置（使用绝对路径）
const configPath = path.join(__dirname, '../../config/config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

/**
 * BIN文件转Token
 */
async function 转换BIN为Token(binPath) {
  try {
    信息日志(`开始转换: ${path.basename(binPath)}`);
    
    // 读取BIN文件
    const binData = fs.readFileSync(binPath);
    const arrayBuffer = new Uint8Array(binData).buffer;
    
    // 发送认证请求
    信息日志('发送认证请求...');
    const response = await axios.post(config.authServer, arrayBuffer, {
      params: { _seq: 1 },
      headers: {
        'Content-Type': 'application/octet-stream',
        'referrerPolicy': 'no-referrer'
      },
      responseType: 'arraybuffer'
    });
    
    // 解析响应
    const responseData = new Uint8Array(response.data);
    信息日志('解密响应数据...');
    
    // 自动检测解密方式
    const decrypted = 自动解密(responseData);
    const parsed = bon.decode(decrypted);
    
    if (parsed.error) {
      throw new Error(parsed.error);
    }
    
    // 如果body是二进制数据，需要再次解码
    let authData = parsed;
    if (parsed.body && parsed.body instanceof Uint8Array) {
      信息日志('解码body字段...');
      authData = bon.decode(parsed.body);
      
      // 调试输出
      console.log('\n===== Body解析结果 =====');
      console.log(JSON.stringify(authData, null, 2));
      console.log('==================\n');
    }
    
    // 验证必需字段
    if (!authData.roleToken || !authData.roleId) {
      throw new Error('认证响应中缺少roleToken或roleId');
    }
    
    // 提取body中的认证数据
    const roleToken = authData.roleToken;
    const roleId = authData.roleId;
    
    // 生成Token
    const currentTime = Date.now();
    const sessId = currentTime * 100 + Math.floor(Math.random() * 100);
    const connId = currentTime + Math.floor(Math.random() * 10);
    
    if (!roleToken || !roleId) {
      throw new Error('认证响应中缺少roleToken或roleId');
    }
    
    const token = {
      roleToken,
      roleId,
      sessId,
      connId,
      isRestore: 0
    };
    
    成功日志(`Token转换成功`);
    
    // 使用BIN文件名作为Token名称（去除.bin后缀和首尾空格）
    const tokenName = path.basename(binPath, '.bin').trim();
    
    return {
      name: tokenName,
      token: JSON.stringify(token),
      createdAt: new Date().toISOString(),
      binFileName: path.basename(binPath),  // 保存原始BIN文件名
      lastRefreshTime: new Date().toISOString()  // 记录最后Token刷新时间
    };
    
  } catch (error) {
    错误日志(`转换失败: ${error.message}`);
    throw error;
  }
}

/**
 * 自动检测解密
 */
function 自动解密(data) {
  // 检测加密类型并解密
  if (data.length > 4 && data[0] === 112 && data[1] === 108) {
    // lx解密
    return lx解密(data);
  } else if (data.length > 4 && data[0] === 112 && data[1] === 120) {
    // x解密
    return x解密(data);
  }
  return data;
}

/**
 * x解密
 */
function x解密(e) {
  const t = ((e[2] >> 6 & 1) << 7) | ((e[2] >> 4 & 1) << 6) | ((e[2] >> 2 & 1) << 5) | ((e[2] & 1) << 4) |
            ((e[3] >> 6 & 1) << 3) | ((e[3] >> 4 & 1) << 2) | ((e[3] >> 2 & 1) << 1) | (e[3] & 1);
  for (let n = e.length; --n >= 4; ) e[n] ^= t;
  return e.subarray(4);
}

/**
 * lx解密 (需要lz4)
 */
function lx解密(e) {
  const t = ((e[2] >> 6 & 1) << 7) | ((e[2] >> 4 & 1) << 6) | ((e[2] >> 2 & 1) << 5) | ((e[2] & 1) << 4) |
            ((e[3] >> 6 & 1) << 3) | ((e[3] >> 4 & 1) << 2) | ((e[3] >> 2 & 1) << 1) | (e[3] & 1);
  for (let n = Math.min(100, e.length); --n >= 2; ) e[n] ^= t;
  e[0] = 4; e[1] = 34; e[2] = 77; e[3] = 24;
  // 这里需要lz4解压，暂时返回原数据
  return e;
}

/**
 * 批量转换BIN文件
 */
async function 批量转换() {
  // 转换为绝对路径（相对于项目根目录）
  const 项目根目录 = path.join(__dirname, '../..');
  const binDir = path.join(项目根目录, 'BIN文件');
  const tokensFile = path.join(项目根目录, 'data/tokens.json');
  
  // 确保数据目录存在
  const dataDir = path.dirname(tokensFile);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  // 清空旧tokens，只保留BIN文件转换的
  let tokens = [];
  
  // 获取所有BIN文件
  const binFiles = fs.readdirSync(binDir).filter(f => f.endsWith('.bin'));
  
  信息日志(`找到 ${binFiles.length} 个BIN文件`);
  
  for (let i = 0; i < binFiles.length; i++) {
    const binFile = binFiles[i];
    try {
      const binPath = path.join(binDir, binFile);
      const result = await 转换BIN为Token(binPath);
      
      // 直接添加，不检查是否存在
      tokens.push(result);
      信息日志(`添加Token: ${result.name}`);
      
      成功日志(`[${i + 1}/${binFiles.length}] ${result.name} 转换完成`);
      
      // 延迟1秒，避免触发服务器限流（65次/分钟）
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      错误日志(`处理失败 ${binFile}: ${error.message}`);
    }
  }
  
  // 保存tokens
  fs.writeFileSync(tokensFile, JSON.stringify(tokens, null, 2), 'utf-8');
  成功日志(`所有Token已保存到: ${tokensFile}`);
  成功日志(`共转换 ${tokens.length} 个Token`);
  
  // 同步任务配置
  信息日志('同步任务配置...');
  if (同步账号配置()) {
    成功日志('任务配置已同步');
  } else {
    错误日志('任务配置同步失败');
  }
  
  // 初始化新账号的状态数据
  信息日志('初始化账号状态...');
  const accountNames = tokens.map(t => t.name);
  if (同步账号状态(accountNames)) {
    成功日志('账号状态已初始化');
  } else {
    信息日志('所有账号状态已存在，无需初始化');
  }
}

// 执行
批量转换().catch(error => {
  错误日志('执行失败:', error);
  process.exit(1);
});
