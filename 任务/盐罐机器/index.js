/**
 * 盐罐机器任务 - 每6小时执行一次
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { 创建WebSocket客户端 } from '../../工具/WebSocket客户端.js';
import { 成功日志, 错误日志, 信息日志, 警告日志 } from '../../工具/日志工具.js';
import { 获取账号配置, 任务是否启用 } from '../../工具/任务配置.js';
import { 更新账号状态, 从角色信息提取状态 } from '../../工具/账号状态.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取tokens
function 读取Tokens() {
  const tokensPath = path.join(__dirname, '../../data/tokens.json');
  return JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
}

// 执行单个账号的盐罐机器任务（带验证和重试）
async function 执行盐罐机器(client, accountName, 最大重试次数 = 3) {
  for (let 重试次数 = 1; 重试次数 <= 最大重试次数; 重试次数++) {
    try {
      if (重试次数 > 1) {
        警告日志(`[${accountName}] 重试 ${重试次数}/${最大重试次数}`);
        
        // 重试前检查连接状态
        if (!client.ws || !client.ws.connected) {
          try {
            client.断开连接();
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const tokens = 读取Tokens();
            const tokenInfo = tokens.find(t => t.name === accountName);
            if (!tokenInfo) {
              throw new Error('未找到账号Token');
            }
            
            await client.连接(tokenInfo.token);
            await new Promise(resolve => setTimeout(resolve, 2000));
          } catch (error) {
            错误日志(`[${accountName}] 重连失败: ${error.message}`);
            throw error;
          }
        }
      }
      
      // 1. 停止盐罐机器人服务
      try {
        await client.发送指令('bottlehelper_stop', {});
      } catch (error) {
        // 忽略stop错误
      }
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 2. 启动盐罐机器人服务
      await client.发送指令('bottlehelper_start', {});
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 3. 获取角色信息验证
      const 角色数据 = await client.发送指令('role_getroleinfo', {});
      
      if (!角色数据) {
        throw new Error('未能获取角色信息');
      }
      
      const bottleHelpers = 角色数据?.role?.bottleHelpers;
      if (!bottleHelpers) {
        throw new Error('未找到盐罐机器人数据');
      }
      
      const now = Date.now() / 1000;
      const helperStopTime = bottleHelpers.helperStopTime || 0;
      const isRunning = helperStopTime > now;
      const remainingTime = Math.max(0, helperStopTime - now);
      const remainingHours = remainingTime / 3600;
      
      // 验证条件：必须在运行中且剩余时间大于7小时
      if (!isRunning) {
        throw new Error(`盐罐机器人未运行`);
      }
      
      if (remainingHours < 7) {
        throw new Error(`剩余时间不足：${Math.floor(remainingHours)}h < 7h`);
      }
      
      // 保存账号状态
      try {
        const 状态数据 = 从角色信息提取状态(角色数据, ['bottleHelper']);
        if (状态数据) {
          更新账号状态(accountName, 状态数据);
        }
      } catch (error) {
        // 静默处理
      }
      
      成功日志(`[${accountName}] 盐罐 ✓ 剩余${Math.floor(remainingHours)}h`);
      return { 
        success: true, 
        重试次数,
        remainingHours: Math.floor(remainingHours)
      };
      
    } catch (error) {
      错误日志(`[${accountName}] 第 ${重试次数}/${最大重试次数} 次尝试失败: ${error.message}`);
      
      if (重试次数 >= 最大重试次数) {
        错误日志(`[${accountName}] 已达到最大重试次数，跳过该账号`);
        return { success: false, error: error.message, 重试次数 };
      }
      
      // 等待后重试
      警告日志(`[${accountName}] 等待3秒后重试...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  return { success: false, error: '未知错误', 重试次数: 最大重试次数 };
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
      // 全部账号模式（手动执行）
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
  const tokens = 读取Tokens();
  
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
  if (!任务是否启用(账号名称, '盐罐机器')) {
    警告日志(`盐罐机器任务未启用，跳过`);
    process.exit(0);
  }
  
  try {
    const client = 创建WebSocket客户端();
    
    // 连接
    await client.连接(tokenData.token);
    成功日志(`连接成功`);
    
    // 执行任务
    const result = await 执行盐罐机器(client, 账号名称);
    
    // 断开连接
    client.断开连接();
    
    // ✅ 修复：无论成功或失败，都记录执行时间（避免循环）
    if (result.success) {
      成功日志('执行完成');
      process.exit(0);
    } else {
      警告日志(`执行失败: ${result.error}，但已记录执行时间（避免循环）`);
      // 失败也返回退出码0，让调度器记录执行时间
      process.exit(0);
    }
  } catch (error) {
    错误日志(`执行失败: ${error.message}`);
    // 异常也返回退出码0，让调度器记录执行时间（避免循环）
    警告日志('已记录执行时间（避免循环）');
    process.exit(0);
  }
}

// 全部账号模式（手动执行）
async function 执行全部账号模式() {
  信息日志('============================================================');
  信息日志('            盐罐机器任务 (每6小时执行)');
  信息日志('============================================================');
  信息日志('');
  
  const tokens = 读取Tokens();
  信息日志(`总计 ${tokens.length} 个账号`);
  信息日志('');
  
  let successCount = 0;
  let failedCount = 0;
  
  // 顺序执行每个账号
  for (let i = 0; i < tokens.length; i++) {
    const tokenInfo = tokens[i];
    const accountName = tokenInfo.name;
    
    // 检查账号是否启用
    const 账号配置 = 获取账号配置(accountName);
    if (!账号配置 || !账号配置.启用) {
      警告日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 账号未启用，跳过`);
      continue;
    }
    
    // 检查任务是否启用
    if (!任务是否启用(accountName, '盐罐机器')) {
      警告日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 盐罐机器任务未启用，跳过`);
      continue;
    }
    
    信息日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 正在处理...`);
    
    try {
      const client = 创建WebSocket客户端();
      
      // 连接
      await client.连接(tokenInfo.token);
      成功日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 连接成功`);
      
      // 执行任务
      const result = await 执行盐罐机器(client, accountName);
      
      // 断开连接
      client.断开连接();
      
      if (result.success) {
        successCount++;
      } else {
        failedCount++;
      }
      
      信息日志('');
      
    } catch (error) {
      错误日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 处理失败: ${error.message}`);
      failedCount++;
      信息日志('');
    }
  }
  
  信息日志('============================================================');
  成功日志(`盐罐机器任务完成！成功: ${successCount}, 失败: ${failedCount}`);
  信息日志('============================================================');
}

// 启动
main();
