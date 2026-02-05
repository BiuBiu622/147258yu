/**
 * 灯神扫荡券领取任务
 * 执行频率: 每天一次
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketClient } from '../../工具/WebSocket客户端.js';
import { 成功日志, 错误日志, 警告日志, 信息日志 } from '../../工具/日志工具.js';
import { 今天已执行, 账号今天已执行, 开始执行, 完成执行, 更新账号记录 } from '../../工具/执行记录.js';
import { 获取账号配置, 任务是否启用 } from '../../工具/任务配置.js';
// 移除未使用的导入
// import { 更新账号状态, 从角色信息提取状态 } from '../../工具/账号状态.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取配置
const 主配置 = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/config.json'), 'utf-8'));
const 任务配置 = JSON.parse(fs.readFileSync(path.join(__dirname, './配置.json'), 'utf-8'));

let client = null;
let currentSeq = 1;
const pendingRequests = new Map();

// ✅ 移除：不再需要检查今天是否可用，直接执行任务，服务器会判断是否已完成

// 全局消息监听器（统一处理所有响应）
function 初始化消息监听器() {
  // 避免重复添加监听器
  client.removeAllListeners('message');
  
  client.on('message', (message) => {
    const ack = message.ack;
    
    // 根据ack精准匹配请求
    if (ack && pendingRequests.has(ack)) {
      const pending = pendingRequests.get(ack);
      clearTimeout(pending.timeoutId);
      pendingRequests.delete(ack);
      pending.resolve(message);
    }
  });
}

// 工具函数: 发送游戏指令（使用seq/ack精准匹配）
async function 发送指令(cmd, body = {}, 描述 = '', 超时时间 = 3000) {
  const seq = currentSeq++;
  const 显示描述 = 描述 || cmd;
  
  信息日志(`[SEQ ${seq}] 执行: ${显示描述}`);
  
  return new Promise((resolve, reject) => {
    // 设置超时
    const timeoutId = setTimeout(() => {
      if (pendingRequests.has(seq)) {
        pendingRequests.delete(seq);
        警告日志(`[SEQ ${seq}] 超时: ${显示描述}`);
        resolve(null); // 超时返回null
      }
    }, 超时时间);
    
    // 注册到待处理队列
    pendingRequests.set(seq, {
      resolve,
      reject,
      timeoutId,
      cmd,
      描述: 显示描述
    });
    
    // 发送命令（带seq）
    client.send(cmd, { ...body, seq });
  });
}

// 灯神任务执行器
async function 执行灯神任务(账号前缀 = '') {
  const prefix = 账号前缀 ? `${账号前缀} ` : '';
  
  信息日志('');
  信息日志(`${prefix}=== 开始执行灯神扫荡券领取任务 ===`);
  信息日志('');
  
  let 任务计数 = 0;
  
  // 灯神免费扫荡（4个国度）- 直接执行，服务器会判断是否已完成
  const kingdoms = ['魏国', '蜀国', '吴国', '群雄'];
  for (let gid = 1; gid <= 4; gid++) {
    await 发送指令('genie_sweep', { genieId: gid }, `${kingdoms[gid - 1]}灯神免费扫荡`, 1000);
    await new Promise(resolve => setTimeout(resolve, 500));
    任务计数++;
  }
  
  // 灯神免费扫荡卷领取 - 直接执行，服务器会判断是否已完成
  for (let i = 1; i <= 3; i++) {
    await 发送指令('genie_buysweep', {}, `领取免费扫荡卷 ${i}/3`, 1000);
    await new Promise(resolve => setTimeout(resolve, 500));
    任务计数++;
  }
  
  成功日志(`${prefix}灯神扫荡券领取完成: ${任务计数}个`);
  信息日志('');
  
  return 任务计数; // 返回执行的任务数量
}

// 单个账号执行函数
async function 执行单个账号(tokenData, 账号索引, 总账号数) {
  const 账号前缀 = `[账号${账号索引 + 1}/${总账号数}: ${tokenData.name}]`;
  const 开始时间 = Date.now();
  let 任务数量 = 0;
  
  try {
    信息日志(`${账号前缀} 正在连接...`);
    
    const actualToken = tokenData.token;
    client = new WebSocketClient(主配置.wsServer, actualToken);
    
    // 连接
    await client.connect();
    成功日志(`${账号前缀} 连接成功！`);
    
    // 初始化全局消息监听器（避免并发冲突）
    初始化消息监听器();
    
    // 等待连接稳定
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 直接执行灯神任务（不需要获取角色信息）
    const 最终结果 = await 执行灯神任务(账号前缀);
    任务数量 = 最终结果;
    
    // 关闭连接
    client.disconnect();
    
    const 执行时长 = Math.round((Date.now() - 开始时间) / 1000);
    成功日志(`${账号前缀} 所有任务执行完毕 (耗时: ${执行时长}秒)`);
    信息日志('');
    
    return { 
      success: true, 
      name: tokenData.name,
      taskCount: 任务数量,
      duration: `${执行时长}秒`
    };
  } catch (error) {
    错误日志(`${账号前缀} 执行失败: ${error.message}`);
    if (client) {
      client.disconnect();
    }
    const 执行时长 = Math.round((Date.now() - 开始时间) / 1000);
    return { 
      success: false, 
      name: tokenData.name, 
      error: error.message,
      taskCount: 任务数量,
      duration: `${执行时长}秒`
    };
  }
}

// 主函数
async function main() {
  try {
    // 检查是否有指定账号参数
    const accountIndex = process.argv.indexOf('--account');
    const 指定账号 = accountIndex !== -1 ? process.argv[accountIndex + 1] : null;
    
    if (指定账号) {
      // 单账号模式（由调度器调用）
      await 执行单个账号模式(指定账号);
    } else {
      // 全部账号模式
      await 执行全部账号模式();
    }
  } catch (error) {
    错误日志('执行失败:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// 单账号模式（由调度器调用）
async function 执行单个账号模式(账号名称) {
  信息日志(`======== 单账号模式: ${账号名称} ========`);
  
  // 读取tokens
  const tokensFile = path.join(__dirname, '../../', 主配置.tokensFile);
  const tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf-8'));
  
  // 查找指定账号
  const tokenData = tokens.find(t => t.name === 账号名称);
  
  if (!tokenData) {
    错误日志(`未找到账号: ${账号名称}`);
    process.exit(1);
  }
  
  // 检查账号是否启用
  const 账号配置 = 获取账号配置(账号名称);
  if (!账号配置 || !账号配置.启用) {
    警告日志(`账号未启用，跳过`);
    process.exit(0);
  }
  
  // 检查任务是否启用
  if (!任务是否启用(账号名称, '灯神')) {
    警告日志(`灯神任务未启用，跳过`);
    process.exit(0);
  }
  
  // 执行任务
  const result = await 执行单个账号(tokenData, 0, 1);
  
  // 保存账号记录
  更新账号记录(result.name, {
    status: result.success ? 'success' : 'failed',
    error: result.error || null,
    taskCount: result.taskCount || 0,
    duration: result.duration || '0秒'
  });
  
  // ✅ 修复：无论成功或失败，都记录执行时间（避免循环）
  if (result.success) {
    成功日志('执行完成');
    process.exit(0);
  } else {
    警告日志(`执行失败: ${result.error}，但已记录执行时间（避免循环）`);
    // 失败也返回退出码0，让调度器记录执行时间
    process.exit(0);
  }
}

// 全部账号模式
async function 执行全部账号模式() {
  try {
    信息日志('='.repeat(60));
    信息日志('           灯神扫荡券领取任务');
    信息日志('='.repeat(60));
    信息日志('');
    
    // 读取tokens
    const tokensFile = path.join(__dirname, '../../', 主配置.tokensFile);
    const tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf-8'));
    
    if (tokens.length === 0) {
      错误日志('没有可用的Token，请先转换BIN文件');
      process.exit(1);
    }
    
    信息日志(`任务: ${任务配置.任务名称}`);
    信息日志(`频率: ${任务配置.执行频率}`);
    信息日志(`总计 ${tokens.length} 个账号`);
    信息日志('');
    
    // 顺序执行所有账号（避免并发冲突）
    信息日志('开始顺序执行...');
    信息日志('');
    
    const results = [];
    
    for (let i = 0; i < tokens.length; i++) {
      const tokenData = tokens[i];
      const accountName = tokenData.name;
      
      // 检查账号是否启用
      const 账号配置 = 获取账号配置(accountName);
      if (!账号配置 || !账号配置.启用) {
        警告日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 账号未启用，跳过`);
        results.push({
          success: false,
          name: accountName,
          error: '账号未启用'
        });
        continue;
      }
      
      // 检查灯神任务是否启用
      if (!任务是否启用(accountName, '灯神')) {
        警告日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 灯神任务未启用，跳过`);
        results.push({
          success: false,
          name: accountName,
          error: '灯神任务未启用'
        });
        continue;
      }
      
      const result = await 执行单个账号(tokenData, i, tokens.length);
      results.push(result);
      
      // 实时保存账号记录（边执行边保存）
      更新账号记录(result.name, {
        status: result.success ? 'success' : 'failed',
        error: result.error || null,
        taskCount: result.taskCount || 0,
        duration: result.duration || '0秒'
      });
    }
    
    // 统计结果
    const 成功 = results.filter(r => r.success).length;
    const 失败 = results.filter(r => !r.success).length;
    
    信息日志('');
    信息日志('='.repeat(60));
    成功日志(`所有账号执行完毕！成功: ${成功}, 失败: ${失败}`);
    
    if (失败 > 0) {
      错误日志('失败账号:');
      results.filter(r => !r.success).forEach(r => {
        错误日志(`  - ${r.name}: ${r.error}`);
      });
    }
    
    信息日志('='.repeat(60));
    信息日志('');
    
  } catch (error) {
    错误日志('执行失败:', error.message);
    console.error(error);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  信息日志('');
  信息日志('正在退出...');
  if (client) {
    client.disconnect();
  }
  process.exit(0);
});

// 启动
main();