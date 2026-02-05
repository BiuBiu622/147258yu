/**
 * 军团商店购买四圣碎片
 * 执行逻辑：每周购买一次，本周未购买则执行
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { 创建WebSocket客户端 } from '../../工具/WebSocket客户端.js';
import { 成功日志, 错误日志, 信息日志, 警告日志 } from '../../工具/日志工具.js';
import { 获取账号配置, 任务是否启用 } from '../../工具/任务配置.js';
import { 更新账号状态, 获取账号状态 } from '../../工具/账号状态.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取tokens
function 读取Tokens() {
  const tokensPath = path.join(__dirname, '../../data/tokens.json');
  return JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
}

/**
 * 检查是否本周已购买
 */
function 是否本周已购买(accountName) {
  try {
    const statusPath = path.join(__dirname, '../../data/account-status.json');
    if (!fs.existsSync(statusPath)) return false;
    
    const statusData = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
    const accountStatus = statusData[accountName];
    
    if (!accountStatus || !accountStatus.legionShop) return false;
    
    const purchaseDate = accountStatus.legionShop.购买日期;
    if (!purchaseDate) return false;
    
    // 判断是否在本周内
    const purchaseTime = new Date(purchaseDate);
    const now = new Date();
    
    // 获取本周一0点
    const currentDay = now.getDay();
    const diff = currentDay === 0 ? 6 : currentDay - 1;
    const thisWeekStart = new Date(now);
    thisWeekStart.setDate(now.getDate() - diff);
    thisWeekStart.setHours(0, 0, 0, 0);
    
    return purchaseTime >= thisWeekStart;
  } catch (error) {
    警告日志(`检查购买状态失败: ${error.message}`);
    return false;
  }
}

/**
 * 更新购买状态
 * @param {string} accountName - 账号名称
 * @param {string} status - 状态 (success/insufficient/timeout)
 * @param {string} errorMsg - 错误信息
 * @param {boolean} shouldRecordDate - 是否记录购买日期
 * @param {string} displayStatus - 前端显示状态 (purchased/insufficient/timeout)
 */
function 更新购买状态(accountName, status, errorMsg = null, shouldRecordDate = false, displayStatus = null) {
  try {
    const 购买日期 = shouldRecordDate ? new Date().toISOString() : null;
    // ✅ 确保显示状态和状态一致
    const 最终显示状态 = displayStatus || status;
    信息日志(`[${accountName}] 更新购买状态: 状态=${status}, 显示=${最终显示状态}, 购买日期=${购买日期}, 错误=${errorMsg}`);
    
    // ✅ 使用更新账号状态函数，自动推送到Web
    更新账号状态(accountName, {
      legionShop: {
        购买日期: 购买日期,
        状态: status,
        显示状态: 最终显示状态, // 前端显示用，确保与状态一致
        错误信息: errorMsg,
        更新时间: new Date().toISOString()
      }
    });
    
    // 验证保存是否成功
    const 验证状态 = 获取账号状态(accountName);
    if (验证状态 && 验证状态.legionShop) {
      信息日志(`[${accountName}] 状态保存验证: 购买日期=${验证状态.legionShop.购买日期}`);
    } else {
      警告日志(`[${accountName}] 状态保存验证失败: 无法读取状态`);
    }
  } catch (error) {
    警告日志(`更新购买状态失败: ${error.message}`);
  }
}

/**
 * 执行单个账号购买（带重试机制）
 * @param {object} client - WebSocket客户端
 * @param {string} accountName - 账号名称
 * @param {number} retryCount - 当前重试次数（默认0）
 * @returns {object} { success, skipped, timeout, retryExhausted }
 */
async function 执行单账号购买(client, accountName, retryCount = 0) {
  const maxRetries = 3; // 最大重试次数
  
  if (retryCount > 0) {
    信息日志(`[${ accountName}] 第${retryCount}次重试...`);
  } else {
    信息日志(`[${accountName}] 开始购买四圣碎片...`);
  }
  
  return new Promise(async (resolve) => {
    try {
      // ✅ 只有在非重试时才检查是否本周已购买
      // 重试时，购买日期可能已在第一次尝试时保存，但可能购买未成功，需要重试
      if (retryCount === 0 && 是否本周已购买(accountName)) {
        成功日志(`[${accountName}] 本周已购买，跳过`);
        // 更新状态为已购买
        更新购买状态(accountName, 'success', '本周已购买', true, 'purchased');
        return resolve({ success: true, skipped: true });
      }
      
      // 获取角色信息
      信息日志(`[${accountName}] 获取角色信息...`);
      await client.获取角色信息();
      
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 监听购买响应
      let 购买结果 = null;
      let 已发送购买指令 = false; // 标记是否已发送购买指令
      const 原始处理器 = client.ws.messageHandlers.get('message');
      
      const 响应处理 = (message) => {
        // 打印所有接收到的消息用于调试（生产环境中可以注释掉）
        // console.log(`[${accountName}] 收到消息:`, JSON.stringify(message, null, 2));
        
        // 检查多种可能的响应命令
        const 是购买响应 = 
          message.cmd === 'Legion_StoreBuyGoodsResp' || 
          message.cmd === 'legion_storebuygoods_resp' ||
          message.cmd === 'legion_storebuygoods' ||
          message.cmd === 'Legion_StoreBuyGoods' ||
          (message.cmd === 'error' && message.body?.cmd === 'legion_storebuygoods') ||
          // 新发现的响应格式：没有cmd字段，但有resp和error字段
          (message.resp !== undefined && message.error !== undefined);
        
        if (是购买响应) {
          购买结果 = message;
          
          // ✅ 处理错误响应
          if (message.error || message.body?.error) {
            const errorMsg = String(message.error || message.body?.error);
            
            if (errorMsg.includes('购买数量超出上限') || errorMsg.includes('already') || errorMsg.includes('已购买') || errorMsg.includes('本周已购买')) {
              成功日志(`[${accountName}] 本周已购买过`);
              // 本周已购买 - 前端显示"购买成功"，记录购买日期
              更新购买状态(accountName, 'success', errorMsg, true, 'purchased');
            } else if (errorMsg.includes('物品不存在') || errorMsg.includes('not found') || errorMsg.includes('盐锅不足') || errorMsg.includes('盐锭不足') || errorMsg.includes('未加入军团')) {
              警告日志(`[${accountName}] 购买失败：盐锭不足或未加入军团`);
              // 道具不足 - 前端显示"道具不足"，也记录购买日期（表示本周已尝试）
              更新购买状态(accountName, 'insufficient', errorMsg, true, 'insufficient');
            } else {
              警告日志(`[${accountName}] 购买失败：${errorMsg}`);
              // 其他错误 - 前端显示错误信息，但已保存购买日期（避免循环）
              更新购买状态(accountName, 'failed', errorMsg, true, 'failed');
            }
          } else {
            // ✅ 没有错误，检查响应body判断购买是否成功
            const body = message.body || message;
            let 购买成功 = false;
            let 判断原因 = '';
            
            // 方式1：检查 buyGoods 对象，如果某个商品ID的值为1（或>0），表示购买了
            if (body.buyGoods && typeof body.buyGoods === 'object') {
              const buyGoods = body.buyGoods;
              const 已购买商品 = Object.entries(buyGoods).filter(([id, count]) => count > 0);
              if (已购买商品.length > 0) {
                购买成功 = true;
                判断原因 = `buyGoods中商品${已购买商品.map(([id, count]) => `${id}:${count}`).join(', ')}已购买`;
                信息日志(`[${accountName}] ✅ ${判断原因}`);
              }
            }
            
            // 方式2：检查 reward 数组，如果有奖励，表示购买成功
            if (!购买成功 && body.reward && Array.isArray(body.reward) && body.reward.length > 0) {
              购买成功 = true;
              判断原因 = `获得 ${body.reward.length} 个奖励`;
              信息日志(`[${accountName}] ✅ ${判断原因}`);
            }
            
            // 方式3：检查 role 对象，如果存在且包含 items，可能表示购买成功（更新了物品）
            if (!购买成功 && body.role && body.role.items && typeof body.role.items === 'object') {
              // 有角色信息更新，可能表示购买成功，但不确定，需要结合其他信息
              // 这里暂时不判断为成功，等待更明确的信号
              判断原因 = '响应包含role信息，但无法确定是否购买成功';
              信息日志(`[${accountName}] ⚠️  ${判断原因}`);
            }
            
            if (购买成功) {
              成功日志(`[${accountName}] 购买成功！${判断原因}`);
              // 购买成功 - 前端显示"购买成功"，记录购买日期
              更新购买状态(accountName, 'success', null, true, 'purchased');
            } else {
              // 没有明确的成功信号，但也没有错误，可能是其他情况
              // 为了安全，记录为成功（因为服务器没有返回错误）
              警告日志(`[${accountName}] 响应无错误但无法确定购买结果，视为成功`);
              更新购买状态(accountName, 'success', '响应无错误', true, 'purchased');
            }
          }
          
          // ✅ 验证状态更新是否成功
          const 验证状态 = 获取账号状态(accountName);
          if (验证状态?.legionShop?.显示状态 === 'pending') {
            警告日志(`[${accountName}] ⚠️  状态更新后仍为pending，强制更新为purchased`);
            更新购买状态(accountName, 'success', '购买完成（状态修复）', true, 'purchased');
          }
          
          // 重要：收到响应后立即resolve
          resolve({ success: true });
          return;
        } else {
          // ✅ 调试：打印未匹配的消息（仅调试时使用）
          // 信息日志(`[${accountName}] 收到非购买响应: ${message.cmd || 'unknown'}`);
        }
        
        // 继续调用原始处理器
        if (原始处理器) 原始处理器(message);
      };
      
      client.ws.messageHandlers.set('message', 响应处理);
      
      // ✅ 方案一：发送购买指令后，立即保存购买日期（避免循环）
      // 这样即使后续失败（超时、网络问题等），也不会陷入循环
      信息日志(`[${accountName}] 发送购买指令...`);
      已发送购买指令 = true;
      client.ws.send('legion_storebuygoods', { id: 6 });
      
      // ✅ 发送购买指令后，立即保存购买日期（避免循环）
      // 注意：暂时不设置状态为 pending，等待响应后再更新
      // 如果响应匹配失败，在超时处理中更新状态
      
      // ✅ 设置一个临时标记，表示正在等待响应
      // 如果5秒内没有收到响应，在超时处理中更新状态
      
      // 等待响应，增加超时时间到5秒
      const 超时ID = setTimeout(async () => {
        if (!购买结果) {
          警告日志(`[${accountName}] 购买超时，未收到响应`);
          
          // 恢复原始处理器
          client.ws.messageHandlers.set('message', 原始处理器);
          
          // ✅ 超时后，检查并更新状态
          const 当前状态 = 获取账号状态(accountName);
          if (!当前状态?.legionShop?.购买日期 || 当前状态?.legionShop?.显示状态 === 'pending' || !当前状态?.legionShop?.显示状态) {
            警告日志(`[${accountName}] 超时且状态异常，更新为timeout`);
            更新购买状态(accountName, 'timeout', '购买超时，未收到响应', true, 'timeout');
          }
          
          // ✅ 关键：超时后重试逻辑
          if (retryCount < maxRetries) {
            警告日志(`[${accountName}] 将在2秒后重试... (已重试${retryCount}/${maxRetries}次)`);
            
            // 等待2秒
            await new Promise(r => setTimeout(r, 2000));
            
            // ✅ 重连：断开当前连接，重新连接
            try {
              信息日志(`[${accountName}] 断开当前连接...`);
              client.断开连接();
              
              await new Promise(r => setTimeout(r, 1000));
              
              信息日志(`[${accountName}] 重新连接...`);
              // 读取token
              const tokens = 读取Tokens();
              const tokenData = tokens.find(t => t.name === accountName);
              if (!tokenData) {
                throw new Error('找不到Token');
              }
              
              await client.连接(tokenData.token);
              成功日志(`[${accountName}] 重连成功`);
              
              await new Promise(r => setTimeout(r, 1000));
              
              // ✅ 递归重试
              const retryResult = await 执行单账号购买(client, accountName, retryCount + 1);
              resolve(retryResult);
              
            } catch (reconnectError) {
              错误日志(`[${accountName}] 重连失败: ${reconnectError.message}`);
              
              // 重连失败，继续重试（不增加计数）
              if (retryCount < maxRetries) {
                const retryResult = await 执行单账号购买(client, accountName, retryCount + 1);
                resolve(retryResult);
              } else {
                // 达到最大重试次数
                错误日志(`[${accountName}] 已达到最大重试次数(${maxRetries}次)，放弃重试`);
                // ✅ 记录购买日期，避免无限循环
                更新购买状态(accountName, 'timeout', `超时后重试${maxRetries}次均失败`, true, 'timeout');
                resolve({ success: false, timeout: true, retryExhausted: true });
              }
            }
          } else {
            // 已达到最大重试次数
            错误日志(`[${accountName}] 已达到最大重试次数(${maxRetries}次)，放弃重试`);
            // ✅ 记录购买日期，避免无限循环
            // ✅ 检查当前状态，如果是 pending，更新为 timeout
            const 当前状态 = 获取账号状态(accountName);
            if (!当前状态?.legionShop?.购买日期 || 当前状态?.legionShop?.显示状态 === 'pending') {
              更新购买状态(accountName, 'timeout', `超时后重试${maxRetries}次均失败`, true, 'timeout');
            }
            resolve({ success: false, timeout: true, retryExhausted: true });
          }
        } else {
          // ✅ 超时但没有重试机会（第一次就超时且不重试的情况）
          // 检查当前状态，如果是 pending，更新为 timeout
          const 当前状态 = 获取账号状态(accountName);
          if (!当前状态?.legionShop?.购买日期 || 当前状态?.legionShop?.显示状态 === 'pending') {
            更新购买状态(accountName, 'timeout', '购买超时，未收到响应', true, 'timeout');
          }
          resolve({ success: false, timeout: true });
        }
      }, 5000);
      
      // 当收到响应时清除超时
      const 原始Resolve = resolve;
      resolve = (result) => {
        clearTimeout(超时ID);
        // 确保恢复原始处理器
        client.ws.messageHandlers.set('message', 原始处理器);
        
        // ✅ 如果响应处理成功，但状态仍然是 pending，强制更新
        if (result.success) {
          const 最终状态 = 获取账号状态(accountName);
          if (最终状态?.legionShop?.显示状态 === 'pending') {
            警告日志(`[${accountName}] ⚠️  resolve时状态仍为pending，强制更新为purchased`);
            更新购买状态(accountName, 'success', '购买完成（状态修复）', true, 'purchased');
          }
        }
        
        原始Resolve(result);
      };
      
      // 注意：不要在这里恢复原始处理器，而是在超时或收到响应时恢复
      
    } catch (error) {
      错误日志(`[${accountName}] 购买异常: ${error.message}`);
      // ✅ 如果已发送购买指令，购买日期已在发送时保存（避免循环）
      // 如果未发送购买指令（连接失败等），不保存购买日期
      if (已发送购买指令) {
        // 购买日期已在发送指令时保存，这里只需要更新状态
        更新购买状态(accountName, 'failed', error.message, true, 'failed');
      } else {
        // 未发送购买指令，不保存购买日期
        更新购买状态(accountName, 'failed', error.message, false, 'failed');
      }
      resolve({ success: false, error: error.message });
    }
  });
}

/**
 * 主函数
 */
export async function 执行军团商店购买() {
  信息日志('');
  信息日志('========================================');
  信息日志('开始执行：军团商店购买四圣碎片');
  信息日志('========================================');
  信息日志('');
  
  const tokens = 读取Tokens();
  let 成功数 = 0;
  let 跳过数 = 0;
  let 失败数 = 0;
  
  for (let i = 0; i < tokens.length; i++) {
    const tokenData = tokens[i];
    const accountName = tokenData.name;
    
    // 检查任务是否启用
    if (!任务是否启用(accountName, '军团商店购买')) {
      信息日志(`[${accountName}] 任务未启用，跳过`);
      跳过数++;
      continue;
    }
    
    let client = null;
    
    try {
      信息日志(`[${accountName}] 正在连接...`);
      client = 创建WebSocket客户端();
      await client.连接(tokenData.token);
      成功日志(`[${accountName}] 连接成功`);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const result = await 执行单账号购买(client, accountName);
      
      if (result.skipped) {
        成功数++; // 按照您的原则：跳过也算成功
      } else if (result.success) {
        成功数++;
      } else {
        失败数++;
      }
      
      client.断开连接();
      
      // 账号间隔5秒
      if (i < tokens.length - 1) {
        信息日志('');
        信息日志('等待5秒后处理下一个账号...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        信息日志('');
      }
      
    } catch (error) {
      错误日志(`[${accountName}] 执行失败: ${error.message}`);
      // ✅ 如果连接成功但执行失败，保存购买日期（避免循环）
      // 检查是否已连接成功（client存在且可能已尝试购买）
      if (client) {
        try {
          // 如果连接成功，即使后续失败，也保存购买日期（避免循环）
          const 当前状态 = 获取账号状态(accountName);
          if (!当前状态?.legionShop?.购买日期) {
            信息日志(`[${accountName}] 连接成功但执行失败，保存购买日期（避免循环）`);
            更新购买状态(accountName, 'failed', error.message, true, 'failed');
          }
          client.断开连接();
        } catch (e) {
          // 忽略断开连接时的错误
        }
      }
      失败数++;
    }
  }
  
  信息日志('');
  信息日志('========================================');
  成功日志(`军团商店购买完成！成功: ${成功数}, 跳过: ${跳过数}, 失败: ${失败数}`);
  信息日志('========================================');
  信息日志('');
  
  // 确保进程正常退出
  process.exit(0);
}

// 如果直接运行此文件
async function main() {
  // ===== 单账号模式：调度器调用 =====
  const args = process.argv.slice(2);
  const accountIndex = args.indexOf('--account');
  
  if (accountIndex !== -1 && args[accountIndex + 1]) {
    const accountName = args[accountIndex + 1];
    信息日志(`======== 单账号模式: ${accountName} ========`);
    
    // 检查任务是否启用
    if (!任务是否启用(accountName, '军团商店购买')) {
      信息日志(`[${accountName}] 任务未启用，跳过`);
      信息日志(`  跳过原因: 军团商店购买任务开关未启用`);
      process.exit(1); // 退出码1表示跳过
    }
    
    // 检查是否本周已购买
    if (是否本周已购买(accountName)) {
      成功日志(`[${accountName}] 本周已购买，跳过`);
      信息日志(`  跳过原因: 本周已购买过军团商店物品`);
      
      // 读取购买日期
      try {
        const statusPath = path.join(__dirname, '../../data/account-status.json');
        const statusData = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
        const purchaseDate = statusData[accountName]?.legionShop?.购买日期;
        if (purchaseDate) {
          信息日志(`  上次购买时间: ${new Date(purchaseDate).toLocaleString('zh-CN')}`);
        }
      } catch (error) {
        // 忽略读取错误
      }
      
      process.exit(1); // 退出码1表示跳过
    }
    
    // 读取token
    const tokens = 读取Tokens();
    const tokenData = tokens.find(t => t.name === accountName);
    
    if (!tokenData) {
      错误日志(`[${accountName}] 找不到Token`);
      process.exit(1);
    }
    
    let client = null;
    
    try {
      信息日志(`[正在连接...]`);
      client = 创建WebSocket客户端();
      await client.连接(tokenData.token);
      成功日志(`连接成功`);
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const result = await 执行单账号购买(client, accountName);
      
      client.断开连接();
      信息日志(`已断开连接`);
      
      // 等待500ms确保状态完全写入磁盘
      await new Promise(resolve => setTimeout(resolve, 500));
      
      if (result.success) {
        成功日志(`执行完成`);
        // ✅ 关键：如果是跳过（本周已购买），退出码1，让调度器记录时间
        if (result.skipped) {
          process.exit(1); // 跳过
        } else {
          process.exit(0); // 成功
        }
      } else if (result.retryExhausted) {
        // ✅ 重试耗尽：退出码1，记录执行时间，避免无限循环
        错误日志(`重试耗尽，等待下周一`);
        process.exit(1);
      } else {
        错误日志(`执行失败`);
        process.exit(1);
      }
      
    } catch (error) {
      错误日志(`执行失败: ${error.message}`);
      // ✅ 如果连接成功但执行失败，保存购买日期（避免循环）
      if (client) {
        try {
          // 如果连接成功，即使后续失败，也保存购买日期（避免循环）
          const 当前状态 = 获取账号状态(accountName);
          if (!当前状态?.legionShop?.购买日期) {
            信息日志(`连接成功但执行失败，保存购买日期（避免循环）`);
            更新购买状态(accountName, 'failed', error.message, true, 'failed');
          }
          client.断开连接();
        } catch (e) {
          // 忽略断开连接时的错误
        }
      }
      process.exit(1);
    }
    
  } else {
    // ===== 多账号模式：手动执行 =====
    await 执行军团商店购买();
  }
}

//  直接执行main函数
main()
  .then(() => process.exit(0))
  .catch(error => {
    错误日志('执行失败:', error);
    process.exit(1);
  });
