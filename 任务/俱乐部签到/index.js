/**
 * 俱乐部签到任务 - 每天执行一次
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

// 执行单个账号的俱乐部签到
async function 执行俱乐部签到(client, accountName) {
  信息日志(`[${accountName}] 开始俱乐部签到...`);
  
  return new Promise(async (resolve) => {
    let 超时定时器 = null;
    
    try {
      // 保存原始消息处理器
      const 原始处理器 = client.ws.messageHandlers.get('message');
      let 已处理 = false;
      let 签到结果 = null;
      
      // 设置消息处理器，监听签到响应和错误
      const 消息处理器 = async (message) => {
        // 检查是否是签到响应
        const cmd = message.cmd?.toLowerCase() || '';
        const 是签到响应 = cmd.includes('legion_signin') || cmd.includes('signin');
        
        // 检查错误消息
        if (message.error) {
          const 错误文本 = String(message.error);
          
          // ✅ 如果错误是"今天已经签到过了"，视为成功（静默处理，不输出错误日志）
          if (错误文本.includes('已经签到') || 错误文本.includes('已签到') || 错误文本.includes('签到过')) {
            // 静默处理，不输出日志
            签到结果 = { success: true, skipped: true, reason: '今天已签到' };
            已处理 = true;
            
            // 清除超时定时器
            if (超时定时器) {
              clearTimeout(超时定时器);
            }
            
            // 恢复原始处理器
            client.ws.messageHandlers.set('message', 原始处理器);
            
            // ✅ 更新状态（即使已签到，也要更新状态）
            // 等待状态更新完成后再 resolve
            try {
              const roleInfo = await client.获取角色信息();
              const 状态数据 = 从角色信息提取状态(roleInfo, ['signin']);
              if (状态数据) {
                更新账号状态(accountName, 状态数据);
              }
            } catch (error) {
              // 静默处理，不输出日志
            }
            
            resolve(签到结果);
            return;
          } else {
            // 其他错误，也视为成功（只要执行过就成功）
            签到结果 = { success: true, skipped: false, reason: '已执行' };
            已处理 = true;
            
            // 清除超时定时器
            if (超时定时器) {
              clearTimeout(超时定时器);
            }
            
            // 恢复原始处理器
            client.ws.messageHandlers.set('message', 原始处理器);
            resolve(签到结果);
            return;
          }
        }
        
        // 检查是否是签到成功响应
        if (是签到响应 && !message.error) {
          签到结果 = { success: true };
          已处理 = true;
          
          // 清除超时定时器
          if (超时定时器) {
            clearTimeout(超时定时器);
          }
          
          // 恢复原始处理器
          client.ws.messageHandlers.set('message', 原始处理器);
          
          // ✅ 更新状态（等待状态更新完成后再 resolve）
          try {
            const roleInfo = await client.获取角色信息();
            const 状态数据 = 从角色信息提取状态(roleInfo, ['signin']);
            if (状态数据) {
              更新账号状态(accountName, 状态数据);
            }
          } catch (error) {
            // 静默处理，不输出日志
          }
          
          resolve(签到结果);
          return;
        }
        
        // 继续调用原始处理器
        if (原始处理器) {
          原始处理器(message);
        }
      };
      
      // 注册消息处理器
      client.ws.messageHandlers.set('message', 消息处理器);
      
      // 发送签到指令（不延迟，立即发送）
      信息日志(`[${accountName}] 执行俱乐部签到`);
      client.ws.send('legion_signin', {});
      
      // 设置超时（3秒，快速响应）
      超时定时器 = setTimeout(async () => {
        if (!已处理) {
          已处理 = true; // 标记为已处理，避免重复resolve
          
          // 恢复原始处理器
          client.ws.messageHandlers.set('message', 原始处理器);
          
          // ✅ 超时也视为成功（只要执行过就成功）
          // 尝试获取状态来更新（等待状态更新完成后再 resolve）
          try {
            const roleInfo = await client.获取角色信息();
            const 状态数据 = 从角色信息提取状态(roleInfo, ['signin']);
            if (状态数据) {
              更新账号状态(accountName, 状态数据);
            }
          } catch (error) {
            // 静默处理，不输出日志
          }
          
          resolve({ success: true, skipped: false, reason: '已执行（超时）' });
        }
      }, 3000); // 缩短超时时间到3秒
      
    } catch (error) {
      // ✅ 异常也视为成功（只要执行过就成功）
      resolve({ success: true, skipped: false, reason: '已执行（异常）' });
    }
  });
}

// 主函数
async function main() {
  try {
    const accountIndex = process.argv.indexOf('--account');
    const 指定账号 = accountIndex !== -1 ? process.argv[accountIndex + 1] : null;
    
    if (指定账号) {
      await 执行单个账号模式(指定账号);
    } else {
      await 执行全部账号模式();
    }
  } catch (error) {
    错误日志('执行失败:', error.message);
    process.exit(1);
  }
}

async function 执行单个账号模式(账号名称) {
  const tokens = 读取Tokens();
  const tokenData = tokens.find(t => t.name === 账号名称);
  
  if (!tokenData) {
    错误日志(`未找到账号: ${账号名称}`);
    process.exit(1);
  }
  
  const 账号配置 = 获取账号配置(账号名称);
  if (!账号配置 || !账号配置.启用) {
    警告日志(`账号未启用，跳过`);
    process.exit(0);
  }
  
  if (!任务是否启用(账号名称, '俱乐部签到')) {
    警告日志(`俱乐部签到任务未启用，跳过`);
    process.exit(0);
  }
  
  try {
    const client = 创建WebSocket客户端();
    await client.连接(tokenData.token);
    const result = await 执行俱乐部签到(client, 账号名称);
    client.断开连接();
    
    // ✅ 俱乐部签到任务：只要执行过就视为成功，没有失败
    // 所有情况都返回退出码0，让调度器记录执行时间
    成功日志('执行完成');
    process.exit(0);
  } catch (error) {
    // ✅ 异常也视为成功（只要执行过就成功），静默处理
    process.exit(0);
  }
}

async function 执行全部账号模式() {
  信息日志('============================================================');
  信息日志('            俱乐部签到任务 (每天执行一次)');
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
    if (!任务是否启用(accountName, '俱乐部签到')) {
      警告日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 俱乐部签到任务未启用，跳过`);
      continue;
    }
    
    信息日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 正在处理...`);
    
    try {
      const client = 创建WebSocket客户端();
      
      // 连接
      await client.连接(tokenInfo.token);
      成功日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 连接成功`);
      
      // 执行任务
      const result = await 执行俱乐部签到(client, accountName);
      
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
  成功日志(`俱乐部签到任务完成！成功: ${successCount}, 失败: ${failedCount}`);
  信息日志('============================================================');
}

main();
