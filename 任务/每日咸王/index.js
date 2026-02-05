/**
 * 每日咸王挑战任务
 * 每天0点后执行一次
 */

import { 创建WebSocket客户端 } from '../../工具/WebSocket客户端.js';
import { 信息日志, 成功日志, 错误日志 } from '../../工具/日志工具.js';
import { 更新账号状态, 读取账号状态 } from '../../工具/账号状态.js';
import { 任务是否启用 } from '../../工具/任务配置.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 获取今日BOSS ID（根据星期几）
function 获取今日BossId() {
  // 周日=9904, 周一=9905, 周二=9901, 周三=9902, 周四=9903, 周五=9904, 周六=9905
  const DAY_BOSS_MAP = [9904, 9905, 9901, 9902, 9903, 9904, 9905];
  const dayOfWeek = new Date().getDay();
  return DAY_BOSS_MAP[dayOfWeek];
}

// 获取星期名称
function 获取星期名称() {
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return days[new Date().getDay()];
}

// 执行每日咸王（带重试机制）
async function 执行每日咸王(tokenData, 账号名称, 账号前缀) {
  const 最大重试次数 = 3;
  let 当前尝试 = 0;
  let 最后错误 = null;
  
  while (当前尝试 < 最大重试次数) {
    当前尝试++;
    let client = null;
    
    try {
      if (当前尝试 > 1) {
        信息日志(`${账号前缀} 第${当前尝试}次尝试...`);
        // 重试前等待2秒
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      信息日志(`${账号前缀} 开始连接游戏...`);
      
      // 每次都重新创建连接
      client = 创建WebSocket客户端();
      await client.连接(tokenData.token);
      信息日志(`${账号前缀} 连接成功`);
      
      // 延迟500毫秒
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 获取今日BOSS ID
      const bossId = 获取今日BossId();
      const 星期 = 获取星期名称();
      
      信息日志(`${账号前缀} ${星期} BOSS ID: ${bossId}`);
      
      // 发送挑战指令并等待响应
      await new Promise((resolve, reject) => {
        let 已响应 = false;
        const 超时定时器 = setTimeout(() => {
          if (!已响应) {
            已响应 = true;
            reject(new Error('响应超时'));
          }
        }, 5000);
        
        const 原始处理器 = client.ws.messageHandlers.get('message');
        const 响应处理 = (message) => {
          // 检查是否是BOSS挑战响应
          if (message.cmd === 'Fight_StartBossResp' || message.cmd === 'fight_startboss_resp') {
            if (!已响应) {
              已响应 = true;
              clearTimeout(超时定时器);
              client.ws.messageHandlers.set('message', 原始处理器);
              
              if (message.body) {
                成功日志(`${账号前缀} 每日咸王挑战成功`);
                
                // 输出战斗结果（如果有）
                if (message.body.battleData?.result) {
                  const result = message.body.battleData.result;
                  if (result.sponsor?.ext?.curHP !== undefined && result.accept?.ext?.curHP !== undefined) {
                    信息日志(`${账号前缀} 我方剩余HP: ${result.sponsor.ext.curHP}`);
                    信息日志(`${账号前缀} BOSS剩余HP: ${result.accept.ext.curHP}`);
                  }
                }
                
                resolve();
              } else {
                reject(new Error('无响应数据'));
              }
            }
          }
          
          // 继续调用原始处理器
          if (原始处理器) 原始处理器(message);
        };
        
        client.ws.messageHandlers.set('message', 响应处理);
        client.ws.send('fight_startboss', { bossId });
      });
      
      // 成功：更新状态并返回
      更新账号状态(账号名称, {
        每日咸王: {
          状态: 'success',
          执行次数: 当前尝试,
          成功次数: 1,
          错误信息: null,
          最后执行时间: new Date().toISOString()
        }
      });
      
      if (client) {
        client.断开连接();
        信息日志(`${账号前缀} 连接已关闭`);
      }
      
      return true; // 成功
      
    } catch (error) {
      最后错误 = error;
      警告日志(`${账号前缀} 第${当前尝试}次尝试失败: ${error.message}`);
      
      if (client) {
        try {
          client.断开连接();
        } catch (e) {
          // 忽略断开连接错误
        }
      }
      
      // 如果还有重试次数，继续循环
      if (当前尝试 < 最大重试次数) {
        信息日志(`${账号前缀} 准备重试...`);
        continue;
      }
    }
  }
  
  // 所有重试都失败了
  错误日志(`${账号前缀} ${最大重试次数}次尝试全部失败`);
  
  // 更新失败状态（记录执行时间，防止无限重试）
  更新账号状态(账号名称, {
    每日咸王: {
      状态: 'failed',
      执行次数: 最大重试次数,
      成功次数: 0,
      错误信息: 最后错误?.message || '未知错误',
      最后执行时间: new Date().toISOString()  // ⚠️ 记录时间，今天不再重试
    }
  });
  
  return false; // 失败
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
  
  // ===== 检查任务是否启用 =====
  if (!任务是否启用(账号名称, '每日咸王')) {
    信息日志(`[${账号名称}] 任务未启用，跳过`);
    信息日志(`  跳过原因: 每日任务总开关或每日咸王子开关未启用`);
    process.exit(1); // 退出码1表示跳过
  }
  
  // ===== 检查今日是否已执行 =====
  const 所有账号状态 = 读取账号状态();
  const 账号状态 = 所有账号状态[账号名称];

  if (账号状态 && 账号状态.每日咸王) {
    const 最后执行时间 = 账号状态.每日咸王.最后执行时间;
    if (最后执行时间) {
      const 最后执行日期 = new Date(最后执行时间);
      const 今天 = new Date();
      const 是今天 = 今天.toDateString() === 最后执行日期.toDateString();
      
      if (是今天) {
        成功日志(`[${账号名称}] 今日已执行，跳过`);
        信息日志(`  跳过原因: 今日已执行过每日咸王任务`);
        信息日志(`  上次执行时间: ${最后执行日期.toLocaleString('zh-CN')}`);
        // ✅ 修复：跳过时也返回退出码0，让调度器记录执行时间（避免循环）
        process.exit(0);
      }
    }
  }
  
  // 读取tokens
  const tokensPath = path.join(__dirname, '../../data/tokens.json');
  if (!fs.existsSync(tokensPath)) {
    错误日志('tokens.json 文件不存在');
    process.exit(1);
  }
  
  const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
  
  // 查找指定账号
  const tokenData = tokens.find(t => t.name === 账号名称);
  
  if (!tokenData) {
    错误日志(`未找到账号: ${账号名称}`);
    process.exit(1);
  }
  
  const 账号前缀 = `[账号: ${账号名称}]`;
  
  try {
    const 成功 = await 执行每日咸王(tokenData, 账号名称, 账号前缀);
    
    // ✅ 修复：无论成功或失败，都记录执行时间（避免循环）
    if (成功) {
      成功日志('执行完成');
      process.exit(0);
    } else {
      警告日志('执行失败（3次尝试全部失败），但已记录执行时间（避免循环）');
      // 失败也返回退出码0，让调度器记录执行时间
      process.exit(0);
    }
  } catch (error) {
    错误日志(`执行异常: ${error.message}`);
    // 异常也返回退出码0，让调度器记录执行时间（避免循环）
    警告日志('已记录执行时间（避免循环）');
    process.exit(0);
  }
}

// 全账号模式（手动执行）
async function 执行全部账号模式() {
  try {
    信息日志('');
    信息日志('========================================');
    信息日志('  每日咸王挑战任务');
    信息日志('========================================');
    信息日志('');
    
    // 读取tokens
    const tokensPath = path.join(__dirname, '../../data/tokens.json');
    if (!fs.existsSync(tokensPath)) {
      错误日志('tokens.json 文件不存在');
      return;
    }
    
    const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
    const 账号列表 = Object.entries(tokens);
    
    信息日志(`总计 ${账号列表.length} 个账号`);
    信息日志('');
    
    let 成功数 = 0;
    let 失败数 = 0;
    
    // 逐个执行（避免并发）
    for (let i = 0; i < 账号列表.length; i++) {
      const [accountName, tokenData] = 账号列表[i];
      const 账号前缀 = `[账号${i + 1}/${账号列表.length}: ${accountName}]`;
      
      try {
        const 成功 = await 执行每日咸王(tokenData, accountName, 账号前缀);
        if (成功) {
          成功数++;
        } else {
          失败数++;
        }
      } catch (error) {
        失败数++;
        错误日志(`${accountName} 执行异常: ${error.message}`);
      }
      
      // 账号间延迟5秒
      if (i < 账号列表.length - 1) {
        信息日志('');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    信息日志('');
    信息日志('========================================');
    成功日志(`任务完成！成功: ${成功数}, 失败: ${失败数}`);
    信息日志('========================================');
  } catch (error) {
    错误日志(`主程序错误: ${error.message}`);
    process.exit(1);
  }
}

// 执行
main();
