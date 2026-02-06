/**
 * BOSS战斗任务 - 独立执行
 * 只包含：军团BOSS
 * 注意：每日BOSS（每日咸王）已移至单独的"每日咸王"任务
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketClient } from '../../工具/WebSocket客户端.js';
import { 成功日志, 错误日志, 警告日志, 信息日志 } from '../../工具/日志工具.js';
import { 获取账号配置, 任务是否启用 } from '../../工具/任务配置.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取配置
const 主配置 = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/config.json'), 'utf-8'));
const tokensFile = path.join(__dirname, '../../', 主配置.tokensFile);

let client = null;

// 获取今日BOSS ID
// ⚠️ 注意：此函数已废弃，每日BOSS由"每日咸王"任务单独处理
// 保留此函数是为了兼容性，但不再使用
function 获取今日BOSSID() {
  // 周日=9904, 周一=9905, 周二=9901, 周三=9902, 周四=9903, 周五=9904, 周六=9905
  const DAY_BOSS_MAP = [9904, 9905, 9901, 9902, 9903, 9904, 9905];
  const dayOfWeek = new Date().getDay();
  return DAY_BOSS_MAP[dayOfWeek];
}

// 发送指令
async function 发送指令(cmd, body = {}, 描述 = '', 延迟 = 500) {
  信息日志(`执行: ${描述 || cmd}`);
  
  return new Promise((resolve, reject) => {
    let resolved = false;
    
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    }, 延迟);
    
    const messageHandler = (message) => {
      const cmdLower = cmd.toLowerCase().replace('_', '');
      const responseCmdLower = message.cmd ? message.cmd.toLowerCase().replace('_', '') : '';
      
      if (responseCmdLower.includes(cmdLower) || responseCmdLower.includes('resp')) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          client.off('message', messageHandler);
          resolve(message);
        }
      }
    };
    
    client.on('message', messageHandler);
    client.send(cmd, body);
  });
}

// 切换阵容
async function 切换阵容(目标阵容, 描述) {
  try {
    信息日志(`${描述}: 切换到阵容${目标阵容}`);
    await 发送指令('role_switchformation', { formationId: 目标阵容 }, `切换到${描述}`, 700); // 1000ms -> 700ms 优化切换阵容延迟
  } catch (error) {
    警告日志(`阵容切换失败: ${error.message}`);
  }
}

// 执行单个账号的BOSS战斗
async function 执行BOSS战斗(tokenData, 账号索引, 总账号数) {
  const accountName = tokenData.name;
  const 账号前缀 = `[账号${账号索引 + 1}/${总账号数}: ${accountName}]`;
  const 开始时间 = Date.now();
  
  try {
    信息日志(`${账号前缀} 正在连接...`);
    
    client = new WebSocketClient(主配置.wsServer, tokenData.token);
    await client.connect();
    成功日志(`${账号前缀} 连接成功`);
    
    await new Promise(resolve => setTimeout(resolve, 500)); // 1000ms -> 500ms 优化连接后等待时间
    
    // 读取账号配置
    const BOSS配置 = 获取账号配置(accountName, 'BOSS战斗');
    
    // 检查是否启用
    if (!BOSS配置 || !BOSS配置.启用) {
      警告日志(`${账号前缀} BOSS战斗未启用，跳过执行`);
      client.disconnect();
      return { success: true, skipped: true };
    }
    
    const BOSS战斗次数 = BOSS配置.战斗次数 || 2;
    const BOSS阵容 = BOSS配置.BOSS阵容 || 1;
    
    if (BOSS战斗次数 <= 0) {
      警告日志(`${账号前缀} BOSS战斗次数为0，跳过执行`);
      client.disconnect();
      return { success: true, skipped: true };
    }
    
    // 切换BOSS阵容
    await 切换阵容(BOSS阵容, 'BOSS阵容');
    
    // 军团BOSS战斗
    信息日志(`${账号前缀} 开始军团BOSS战斗...`);
    let 军团BOSS成功 = 0;
    for (let i = 1; i <= BOSS战斗次数; i++) {
      const 结果 = await 发送指令('fight_startlegionboss', {}, `军团BOSS ${i}/${BOSS战斗次数}`, 12000);
      if (结果) 军团BOSS成功++;
      await new Promise(resolve => setTimeout(resolve, 300)); // 500ms -> 300ms 优化每次BOSS战斗后延迟
    }
    
    // ⚠️ 每日BOSS战斗已移除，由"每日咸王"任务单独处理
    // 原因：避免重复执行，每日咸王有独立的调度逻辑
    
    client.disconnect();
    
    const 执行时长 = Math.round((Date.now() - 开始时间) / 1000);
    成功日志(`${账号前缀} 完成 (军团BOSS:${军团BOSS成功}/${BOSS战斗次数}, 耗时:${执行时长}秒)`);
    信息日志('');
    
    return { 
      success: true, 
      name: accountName,
      军团BOSS成功,
      duration: `${执行时长}秒`
    };
  } catch (error) {
    错误日志(`${账号前缀} 执行失败: ${error.message}`);
    if (client) {
      client.disconnect();
    }
    return { 
      success: false, 
      name: accountName, 
      error: error.message 
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
      // 全账号模式（手动执行）
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
  const tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf-8'));
  
  // 查找指定账号
  const tokenData = tokens.find(t => t.name === 账号名称);
  
  if (!tokenData) {
    错误日志(`未找到账号: ${账号名称}`);
    process.exit(1);
  }
  
  // ✅ 修复：使用任务是否启用函数，检查账号总开关和任务开关
  if (!任务是否启用(账号名称, 'BOSS战斗')) {
    警告日志(`BOSS战斗未启用，跳过`);
    process.exit(0);
  }
  
  const BOSS配置 = 获取账号配置(账号名称, 'BOSS战斗');
  
  const result = await 执行BOSS战斗(tokenData, 0, 1);
  
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

// 全账号模式（手动执行）
async function 执行全部账号模式() {
  信息日志('='.repeat(60));
  信息日志('         BOSS战斗任务（仅军团BOSS）');
  信息日志('         每日BOSS请使用"每日咸王"任务');
  信息日志('='.repeat(60));
  信息日志('');
  
  // 读取tokens
  const tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf-8'));
  
  if (tokens.length === 0) {
    错误日志('没有可用的Token');
    return;
  }
  
  信息日志(`总计 ${tokens.length} 个账号`);
  信息日志('');
  
  const results = [];
  
  // 顺序执行所有账号
  for (let i = 0; i < tokens.length; i++) {
    const tokenData = tokens[i];
    const accountName = tokenData.name;
    
    // ✅ 修复：使用任务是否启用函数，检查账号总开关和任务开关
    if (!任务是否启用(accountName, 'BOSS战斗')) {
      警告日志(`[账号${i + 1}/${tokens.length}: ${accountName}] BOSS战斗未启用，跳过`);
      results.push({
        success: true,
        skipped: true,
        name: accountName
      });
      continue;
    }
    
    const BOSS配置 = 获取账号配置(accountName, 'BOSS战斗');
    
    const result = await 执行BOSS战斗(tokenData, i, tokens.length);
    results.push(result);
  }
  
  // 统计结果
  const 成功 = results.filter(r => r.success && !r.skipped).length;
  const 跳过 = results.filter(r => r.skipped).length;
  const 失败 = results.filter(r => !r.success).length;
  
  信息日志('');
  信息日志('='.repeat(60));
  成功日志(`所有账号执行完毕！成功: ${成功}, 跳过: ${跳过}, 失败: ${失败}`);
  
  if (失败 > 0) {
    错误日志('失败账号:');
    results.filter(r => !r.success).forEach(r => {
      错误日志(`  - ${r.name}: ${r.error}`);
    });
  }
  
  信息日志('='.repeat(60));
  信息日志('');
}

// 启动
main();
