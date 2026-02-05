/**
 * 挂机奖励任务 - 每8小时执行一次
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

// 执行单个账号的挂机奖励任务（参考原项目，移除验证逻辑）
async function 执行挂机奖励(client, accountName, tokenData) {
  信息日志(`[${accountName}] 开始挂机奖励任务...`);
  
  try {
    // ===== 阶段1: 检测连接状态 =====
    信息日志(`[${accountName}] [阶段1/4] 检测连接状态...`);
    
    // 使用正确的方法检查连接状态
    // client.ws 是 WebSocketClient 实例，使用 isConnected() 方法检查
    const 连接正常 = client.ws && client.ws.isConnected();
    
    if (连接正常) {
      成功日志(`[${accountName}] 连接状态正常`);
    } else {
      警告日志(`[${accountName}] 连接状态异常，尝试重连...`);
      
      try {
        // 关闭旧连接
        try {
          client.断开连接();
        } catch (e) {
          // 忽略关闭错误
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // 重新连接
        await client.连接(tokenData.token);
        成功日志(`[${accountName}] 重连成功`);
        
        // 等待连接稳定
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        错误日志(`[${accountName}] 重连失败: ${error.message}`);
        throw new Error('重连失败，中止任务');
      }
    }
    
    // ===== 阶段2: 领取挂机奖励（1次） =====
    信息日志(`[${accountName}] [阶段2/4] 领取挂机奖励`);
    await client.发送指令('system_claimhangupreward', {});
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // ===== 阶段3: 挂机加钟（4次） =====
    信息日志(`[${accountName}] [阶段3/4] 挂机加钟（4次）`);
    for (let i = 1; i <= 4; i++) {
      信息日志(`[${accountName}] 挂机加钟 ${i}/4`);
      await client.发送指令('system_mysharecallback', { 
        isSkipShareCard: true, 
        type: 2 
      });
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    // ===== 阶段4: 获取剩余挂机时间 =====
    await new Promise(resolve => setTimeout(resolve, 300));
    信息日志(`[${accountName}] [阶段4/4] 获取剩余挂机时间...`);
    
    const response = await client.发送指令('role_getroleinfo', {
      clientVersion: '1.65.3-wx',
      inviteUid: 0,
      platform: 'hortor',
      platformExt: 'mix',
      scene: ''
    });
    
    // 保存账号状态
    if (response) {
      try {
        let 角色数据 = response;
        
        // 如果有body字段，使用body
        if (response.body) {
          角色数据 = response.body;
        }
        
        // 如果是Uint8Array，需要解码
        if (角色数据 instanceof Uint8Array) {
          const { bon } = await import('../../工具/BON协议.js');
          角色数据 = bon.decode(角色数据);
        }
        
        // 只提取挂机相关数据，不影响其他任务
        const 状态数据 = 从角色信息提取状态(角色数据, ['hangUp']);
        if (状态数据) {
          更新账号状态(accountName, 状态数据);
          
          // 显示挂机信息（与原项目一致）
          const hangUp = 角色数据?.role?.hangUp;
          if (hangUp) {
            const now = Date.now() / 1000;
            const lastTime = hangUp.lastTime || 0;
            const hangUpTime = hangUp.hangUpTime || 0;
            const elapsedTime = now - lastTime;
            const remainingTime = Math.max(0, hangUpTime - elapsedTime);
            
            // 格式化时间显示（HH:MM:SS）
            const formatTime = (seconds) => {
              const total = Math.floor(Number(seconds) || 0);
              if (total <= 0) return '00:00:00';
              const h = Math.floor(total / 3600).toString().padStart(2, '0');
              const m = Math.floor((total % 3600) / 60).toString().padStart(2, '0');
              const s = (total % 60).toString().padStart(2, '0');
              return `${h}:${m}:${s}`;
            };
            
            信息日志(`[${accountName}] 已挂机时间: ${formatTime(elapsedTime)}`);
            信息日志(`[${accountName}] 剩余时间: ${formatTime(remainingTime)}`);
          }
        }
      } catch (error) {
        警告日志(`[${accountName}] 保存状态失败: ${error.message}`);
      }
    }
    
    成功日志(`[${accountName}] 挂机奖励任务执行完成，已自动加钟`);
    return { success: true };
    
  } catch (error) {
    错误日志(`[${accountName}] 挂机奖励任务执行失败: ${error.message}`);
    return { success: false, error: error.message };
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
  if (!任务是否启用(账号名称, '挂机奖励')) {
    警告日志(`挂机奖励任务未启用，跳过`);
    process.exit(0);
  }
  
  try {
    const client = 创建WebSocket客户端();
    
    // 连接
    await client.连接(tokenData.token);
    成功日志(`连接成功`);
    
    // 等待连接稳定
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 执行任务
    const result = await 执行挂机奖励(client, 账号名称, tokenData);
    
    // 等待最后一次命令处理完成
    await new Promise(resolve => setTimeout(resolve, 300));
    
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
  信息日志('            挂机奖励任务 (每6小时执行)');
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
    if (!任务是否启用(accountName, '挂机奖励')) {
      警告日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 挂机奖励任务未启用，跳过`);
      continue;
    }
    
    信息日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 正在处理...`);
    
    try {
      const client = 创建WebSocket客户端();
      
      // 连接
      await client.连接(tokenInfo.token);
      成功日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 连接成功`);
      
      // 等待连接稳定（1秒）
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 执行任务
      const result = await 执行挂机奖励(client, accountName, tokenInfo);
      
      // 等待最后一次命令处理完成
      await new Promise(resolve => setTimeout(resolve, 300));
      
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
  成功日志(`挂机奖励任务完成！成功: ${successCount}, 失败: ${failedCount}`);
  信息日志('============================================================');
}

// 启动
main();
