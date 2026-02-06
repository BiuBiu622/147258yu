/**
 * 咸将塔任务
 * 功能：自动挑战塔层，直到能量用完
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketClient } from '../../工具/WebSocket客户端.js';
import { 成功日志, 错误日志, 警告日志, 信息日志 } from '../../工具/日志工具.js';
import { 获取账号配置, 任务是否启用 } from '../../工具/任务配置.js';
import { 更新账号状态, 获取账号状态 } from '../../工具/账号状态.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取配置
const 主配置 = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/config.json'), 'utf-8'));
const tokensFile = path.join(__dirname, '../../', 主配置.tokensFile);

let client = null;

// 解析BON数据（与参考脚本保持一致）
async function 解析BON数据(data) {
  // 如果data是Uint8Array，直接解码
  if (data instanceof Uint8Array) {
    const { bon } = await import('../../工具/BON协议.js');
    return bon.decode(data);
  }
  
  // 如果data是对象但包含数字键（BON编码格式），需要解码
  // ⚠️ 注意：参考脚本的检查条件是 !角色数据.role，即如果已经有role字段就不解码
  if (data && typeof data === 'object' && !Array.isArray(data) && !data.role) {
    const keys = Object.keys(data);
    // 检查是否所有键都是数字（BON编码格式）
    if (keys.length > 0 && keys.every(key => !isNaN(parseInt(key)))) {
      try {
        // 转换为Uint8Array再解码
        const bytes = new Uint8Array(Object.values(data));
        const { bon } = await import('../../工具/BON协议.js');
        return bon.decode(bytes);
      } catch (e) {
        // 解码失败，尝试直接使用
        return data;
      }
    }
  }
  
  // 如果已经有role字段或者是其他格式，直接返回
  return data;
}

// 发送指令（带连接状态检查）
async function 发送指令(cmd, body = {}, 描述 = '', 超时 = 15000, 账号前缀 = '', tokenData = null) {
  信息日志(`发送命令: ${描述 || cmd}`);
  
  // ✅ 检查WebSocket连接状态，如果断开则重连
  if (!client || !client.ws || client.ws.readyState !== 1) {
    if (账号前缀 && tokenData) {
      警告日志(`${账号前缀} [发送指令] WebSocket连接已断开，正在重新连接...`);
      try {
        // 清理旧连接
        if (client) {
          try {
            client.disconnect();
          } catch (e) {
            // 忽略断开连接错误
          }
        }
        
        // 重新建立连接
        client = new WebSocketClient(主配置.wsServer, tokenData.token);
        await client.connect();
        成功日志(`${账号前缀} [发送指令] 重新连接成功`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (reconnectError) {
        错误日志(`${账号前缀} [发送指令] 重新连接失败: ${reconnectError.message}`);
        return null; // 连接失败，返回null
      }
    } else {
      // 如果没有提供账号前缀和tokenData，无法重连，直接返回null
      错误日志(`[发送指令] WebSocket连接已断开，且无法重连（缺少账号信息）`);
      return null;
    }
  }
  
  return new Promise((resolve, reject) => {
    let resolved = false;
    
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    }, 超时);
    
    const messageHandler = (message) => {
      const cmdLower = cmd.toLowerCase().replace(/_/g, '');
      const responseCmdLower = message.cmd ? message.cmd.toLowerCase().replace(/_/g, '') : '';
      
      if (responseCmdLower.includes(cmdLower) || responseCmdLower.includes('resp')) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          client.off('message', messageHandler);
          resolve(message);
        }
      }
    };
    
    try {
      client.on('message', messageHandler);
      client.send(cmd, body);
    } catch (error) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        client.off('message', messageHandler);
        错误日志(`[发送指令] 发送失败: ${error.message}`);
        resolve(null);
      }
    }
  });
}

// 格式化层数（towerId转换为层数-关卡格式）
function 格式化层数(towerId) {
  if (!towerId) return '-';
  const 层数 = Math.floor(towerId / 10) + 1;
  const 关卡 = towerId % 10;
  return `${层数}-${关卡}`;
}

// 获取本周周一日期字符串
function 获取本周周一() {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // 周一
  const monday = new Date(now.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday.toDateString();
}

// 检查是否有未领取的奖励
function 检查未领取奖励(towerId, reward) {
  if (!towerId || !reward) return null;
  
  const 当前层数 = Math.floor(towerId / 10) + 1;
  const 上一层层数 = 当前层数 - 1;
  const 已领取层数列表 = Object.keys(reward || {}).map(k => parseInt(k));
  const 有未领取奖励 = !已领取层数列表.includes(上一层层数);
  
  if (有未领取奖励) {
    return 上一层层数;
  }
  
  return null;
}

// 检查并确保WebSocket连接在线（带重连）
async function 检查并确保连接在线(账号前缀, tokenData) {
  const 连接状态 = client && client.ws ? client.ws.readyState : -1;
  const 状态描述 = {
    0: 'CONNECTING（连接中）',
    1: 'OPEN（已连接）',
    2: 'CLOSING（关闭中）',
    3: 'CLOSED（已关闭）',
    '-1': '未初始化'
  };
  
  信息日志(`${账号前缀} [连接检查] 当前连接状态: ${状态描述[连接状态] || '未知'} (readyState: ${连接状态})`);
  
  // readyState === 1 表示连接已打开
  if (连接状态 === 1) {
    信息日志(`${账号前缀} [连接检查] ✓ 账号在线，连接正常`);
    return true;
  }
  
  // 连接不在线，需要重连
  警告日志(`${账号前缀} [连接检查] ✗ 账号不在线，开始重新连接...`);
  
  try {
    // 清理旧连接
    if (client) {
      try {
        client.disconnect();
        信息日志(`${账号前缀} [连接检查] 已清理旧连接`);
      } catch (e) {
        // 忽略断开连接错误
        信息日志(`${账号前缀} [连接检查] 清理旧连接时出现错误（可忽略）: ${e.message}`);
      }
    }
    
    // 重新建立连接
    信息日志(`${账号前缀} [连接检查] 正在重新连接WebSocket服务器: ${主配置.wsServer}`);
    client = new WebSocketClient(主配置.wsServer, tokenData.token);
    await client.connect();
    成功日志(`${账号前缀} [连接检查] ✓ 重新连接成功`);
    await new Promise(resolve => setTimeout(resolve, 1000)); // 等待1秒确保连接稳定
    
    // 再次检查连接状态
    const 重连后状态 = client && client.ws ? client.ws.readyState : -1;
    if (重连后状态 === 1) {
      成功日志(`${账号前缀} [连接检查] ✓ 重连后连接状态正常`);
      return true;
    } else {
      错误日志(`${账号前缀} [连接检查] ✗ 重连后连接状态异常: ${状态描述[重连后状态] || '未知'} (readyState: ${重连后状态})`);
      return false;
    }
  } catch (reconnectError) {
    错误日志(`${账号前缀} [连接检查] ✗ 重新连接失败: ${reconnectError.message}`);
    return false;
  }
}

// 获取角色信息（包含塔层数据，带断线重连）
async function 获取角色信息(账号前缀, tokenData, 最大重试次数 = 5) {
  let 重试次数 = 0;
  
  while (重试次数 < 最大重试次数) {
    重试次数++;
    
    try {
      // ✅ 检查WebSocket连接状态，如果断开则重连
      if (!client || !client.ws || client.ws.readyState !== 1) {
        警告日志(`${账号前缀} WebSocket连接已断开，正在重新连接... (尝试 ${重试次数}/${最大重试次数})`);
        
        try {
          // 清理旧连接
          if (client) {
            try {
              client.disconnect();
            } catch (e) {
              // 忽略断开连接错误
            }
          }
          
          // 重新建立连接
          client = new WebSocketClient(主配置.wsServer, tokenData.token);
          await client.connect();
          
          成功日志(`${账号前缀} 重新连接成功`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (reconnectError) {
          错误日志(`${账号前缀} 重新连接失败: ${reconnectError.message}`);
          if (重试次数 < 最大重试次数) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          continue; // 继续重试
        }
      }
      
      // ✅ 关键修复：先发送 Tower_GetInfo 命令进入塔界面，然后使用 scene: 'tower' 获取角色信息
      // 这样可以确保获取到正确的能量值
      try {
        信息日志(`${账号前缀} [获取角色信息] 先进入塔界面...`);
        await 发送指令('Tower_GetInfo', {}, '获取塔信息', 5000, 账号前缀, tokenData);
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (e) {
        // 忽略错误，继续执行
        警告日志(`${账号前缀} [获取角色信息] 进入塔界面失败或命令不存在，继续执行`);
      }
      
      // 发送获取角色信息指令（使用 scene: 'tower' 以确保获取到正确的能量值）
      const response = await 发送指令('role_getroleinfo', {
        clientVersion: '1.65.3-wx',
        inviteUid: 0,
        platform: 'hortor',
        platformExt: 'mix',
        scene: 'tower'  // ✅ 关键：使用 'tower' 作为 scene 参数
      }, '获取角色信息', 10000, 账号前缀, tokenData);
      
      if (!response) {
        警告日志(`${账号前缀} 获取角色信息超时 (尝试 ${重试次数}/${最大重试次数})`);
        if (重试次数 < 最大重试次数) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        continue; // 继续重试
      }
      
      // 解析响应（与参考脚本逻辑完全一致）
      let 角色数据 = null;
      
      if (!response || !response.body) {
        警告日志(`${账号前缀} 获取角色信息失败，响应为空 (尝试 ${重试次数}/${最大重试次数})`);
        if (重试次数 < 最大重试次数) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        continue; // 继续重试
      }
      
      // ✅ 参考脚本的解析逻辑：先取response.body，然后根据类型决定是否解码
      角色数据 = response.body;
      
      // ✅ 如果body是Uint8Array，需要解码
      if (角色数据 instanceof Uint8Array) {
        const { bon } = await import('../../工具/BON协议.js');
        角色数据 = bon.decode(角色数据);
      }
      // ✅ 如果body是对象但包含数字键（BON编码格式），也需要解码
      // ⚠️ 关键：参考脚本的检查条件是 !角色数据.role，即如果已经有role字段就不解码
      else if (角色数据 && typeof 角色数据 === 'object' && !Array.isArray(角色数据) && !角色数据.role) {
        const keys = Object.keys(角色数据);
        // 检查是否所有键都是数字（BON编码格式）
        if (keys.length > 0 && keys.every(key => !isNaN(parseInt(key)))) {
          try {
            // 转换为Uint8Array再解码
            const bytes = new Uint8Array(Object.values(角色数据));
            const { bon } = await import('../../工具/BON协议.js');
            角色数据 = bon.decode(bytes);
          } catch (e) {
            // 解码失败，尝试直接使用
          }
        }
      }
      
      // ✅ 如果response直接包含role字段（不在body中），使用response
      if (!角色数据 || !角色数据.role) {
        if (response.role) {
          角色数据 = response;
        }
      }
      
      if (!角色数据 || !角色数据.role) {
        警告日志(`${账号前缀} 角色信息解析失败 (尝试 ${重试次数}/${最大重试次数})`);
        if (重试次数 < 最大重试次数) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        continue; // 继续重试
      }
      
      // ✅ 成功获取到角色信息，输出简洁信息
      if (角色数据.role.tower) {
        const tower = 角色数据.role.tower;
        const 层数 = 格式化层数(tower.id);
        if (重试次数 === 1) {
          信息日志(`${账号前缀} 当前层数：${层数}，当前能量值：${tower.energy}`);
        } else {
          信息日志(`${账号前缀} 当前层数：${层数}，当前能量值：${tower.energy} (重试 ${重试次数} 次)`);
        }
      }
      
      return 角色数据;
      
    } catch (error) {
      错误日志(`${账号前缀} 获取角色信息异常: ${error.message} (尝试 ${重试次数}/${最大重试次数})`);
      if (重试次数 < 最大重试次数) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      // 继续重试
    }
  }
  
  // 所有重试都失败
  throw new Error(`获取角色信息失败，已重试 ${最大重试次数} 次`);
}

// 执行单个账号的塔挑战
async function 执行塔挑战(tokenData, 账号索引, 总账号数) {
  const accountName = tokenData.name;
  const 账号前缀 = `[账号${账号索引 + 1}/${总账号数}: ${accountName}]`;
  const 开始时间 = Date.now();
  
  // ✅ 在函数作用域初始化变量，避免异常处理时未定义
  let 当前towerId = 0;
  let 当前energy = 0;
  let 当天统计 = null;
  let 本周统计 = null;
  
  try {
    // ✅ 执行流程：登录 → 获取角色信息 → 判断能量 → 执行挑战
    // 判断是否运行的唯一逻辑：近6小时未运行 && 任务配置开关打开（已在单账号模式中检查）
    
    信息日志(`${账号前缀} ========== 开始执行咸将塔任务 ==========`);
    信息日志(`${账号前缀} [初始化] 正在连接WebSocket服务器: ${主配置.wsServer}`);
    
    client = new WebSocketClient(主配置.wsServer, tokenData.token);
    await client.connect();
    成功日志(`${账号前缀} [初始化] WebSocket连接成功`);
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 1. 获取角色信息（登录后获取，用于判断能量）
    信息日志(`${账号前缀} [步骤1] 开始获取角色信息...`);
    let 角色数据 = null;
    let reward = {};
    
    try {
      角色数据 = await 获取角色信息(账号前缀, tokenData, 3);
      
      if (!角色数据 || !角色数据.role || !角色数据.role.tower) {
        throw new Error('无法获取塔信息');
      }
      
      const tower = 角色数据.role.tower;
      当前towerId = tower.id;
      当前energy = tower.energy;
      reward = tower.reward || {};
      
      信息日志(`${账号前缀} [步骤1] 当前层数：${格式化层数(当前towerId)}，当前能量值：${当前energy}`);
    } catch (error) {
      // ✅ 初始获取失败（重试3次后），假设能量=0，不记录执行时间，下次调度器循环继续尝试
      错误日志(`${账号前缀} 初始获取角色信息失败（已重试3次）: ${error.message}`);
      警告日志(`${账号前缀} 假设能量=0，不记录执行时间，下次调度器循环继续尝试`);
      当前energy = 0; // 假设能量=0
      
      // ✅ 获取不到能量值，记录状态（能量=0，挑战次数=0），但不记录执行时间
      client.disconnect();
      
      // 尝试从现有状态获取towerId（如果有）
      const 获取不到能量时的状态 = 获取账号状态(accountName);
      if (获取不到能量时的状态 && 获取不到能量时的状态.tower && 获取不到能量时的状态.tower.towerId) {
        当前towerId = 获取不到能量时的状态.tower.towerId;
        信息日志(`${账号前缀} 使用上次保存的层数: ${格式化层数(当前towerId)}`);
      }
      
      // 初始化统计（确保记录挑战次数、成功次数、失败次数）
      const 今天 = new Date().toDateString();
      const 本周周一 = 获取本周周一();
      const 获取不到能量时的tower = 获取不到能量时的状态?.tower || {};
      const 获取不到能量时的当天统计 = 获取不到能量时的tower.today || { challengeCount: 0, successCount: 0, failCount: 0, date: 今天 };
      const 获取不到能量时的本周统计 = 获取不到能量时的tower.week || { 
        challengeCount: 0, 
        successCount: 0, 
        failCount: 0,
        initialTowerId: 当前towerId,
        currentTowerId: 当前towerId,
        weekStartDate: 本周周一
      };
      
      // ✅ 更新状态（能量=0，挑战次数=0），但不记录执行时间，这样下次调度器循环会继续尝试
      更新账号状态(accountName, {
        tower: {
          towerId: 当前towerId,
          energy: 0,
          // 不设置 lastExecuteTime，让下次调度器循环继续尝试
          today: 获取不到能量时的当天统计,
          week: 获取不到能量时的本周统计,
          status: 'pending',
          error: `获取角色信息失败: ${error.message}`
        }
      });
      
      return { 
        success: true, 
        name: accountName,
        challengeCount: 0,
        successCount: 0,
        failCount: 0,
        currentTowerId: 当前towerId,
        energy: 0,
        reason: '获取角色信息失败，假设能量=0，未记录执行时间，下次调度器循环继续尝试'
      };
    }
    
    // 2. 读取账号配置（用于切换阵容）
    信息日志(`${账号前缀} [步骤2] 读取账号配置...`);
    const 塔配置 = 获取账号配置(accountName, '咸将塔');
    const 塔阵容 = 塔配置?.爬塔阵容 || 1;
    信息日志(`${账号前缀} [步骤2] 配置读取完成: 启用=${塔配置?.启用 !== false}, 爬塔阵容=${塔阵容}`);
    
    // 3. 切换爬塔阵容（失败不影响继续执行）
    信息日志(`${账号前缀} [步骤3] 切换爬塔阵容...`);
    await 切换阵容(塔阵容, '爬塔阵容', 账号前缀, tokenData);
    
    // 4. 读取现有状态（用于统计初始化）
    信息日志(`${账号前缀} [步骤4] 读取现有状态...`);
    const 现有状态 = 获取账号状态(accountName);
    const 现有tower = 现有状态?.tower || {};
    信息日志(`${账号前缀} [步骤4] 现有状态: 层数=${格式化层数(现有tower.towerId || 0)}, 能量=${现有tower.energy || 0}, 最后执行=${现有tower.lastExecuteTime || '无'}`);
    
    // 5. 记录当前能量状态
    信息日志(`${账号前缀} [步骤5] 能量检查: 当前能量=${当前energy}，${当前energy > 0 ? '可以开始挑战' : '能量为0，将记录状态'}`);
    
    // 6. 检查是否有未领取的奖励
    信息日志(`${账号前缀} [步骤6] 检查未领取奖励...`);
    const 未领取层数 = 检查未领取奖励(当前towerId, reward);
    if (未领取层数) {
      信息日志(`${账号前缀} [步骤6] 发现未领取的奖励：${未领取层数}层，正在领取...`);
      const claimResponse = await 发送指令('tower_claimreward', {
        rewardId: 未领取层数
      }, `领取${未领取层数}层奖励`, 10000, 账号前缀, tokenData);
      
      if (claimResponse) {
        成功日志(`${账号前缀} [步骤6] 奖励领取成功`);
      } else {
        警告日志(`${账号前缀} [步骤6] 奖励领取可能失败，但继续执行`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
    } else {
      信息日志(`${账号前缀} [步骤6] 无未领取奖励`);
    }
    
    // 7. 初始化统计
    信息日志(`${账号前缀} [步骤7] 初始化统计...`);
    const 今天 = new Date().toDateString();
    const 本周周一 = 获取本周周一();
    信息日志(`${账号前缀} [步骤7] 日期信息: 今天=${今天}, 本周周一=${本周周一}`);
    
    // ✅ 修复：使用赋值而不是const重新声明，确保外层变量被正确赋值
    const 原有当天统计 = 现有tower.today || { challengeCount: 0, successCount: 0, failCount: 0 };
    const 原有本周统计 = 现有tower.week || { 
      challengeCount: 0, 
      successCount: 0, 
      failCount: 0,
      initialTowerId: null,
      currentTowerId: null,
      weekStartDate: null
    };
    
    信息日志(`${账号前缀} [步骤7] 原有统计 - 当天: 挑战=${原有当天统计.challengeCount}, 成功=${原有当天统计.successCount}, 失败=${原有当天统计.failCount}, 日期=${原有当天统计.date || '无'}`);
    信息日志(`${账号前缀} [步骤7] 原有统计 - 本周: 挑战=${原有本周统计.challengeCount}, 成功=${原有本周统计.successCount}, 失败=${原有本周统计.failCount}, 初始层数=${格式化层数(原有本周统计.initialTowerId || 0)}, 当前层数=${格式化层数(原有本周统计.currentTowerId || 0)}`);
    
    当天统计 = { ...原有当天统计 };
    本周统计 = { ...原有本周统计 };
    
    // 检查是否新的一天
    if (当天统计.date !== 今天) {
      信息日志(`${账号前缀} [步骤7] 检测到新的一天，重置当天统计`);
      当天统计.challengeCount = 0;
      当天统计.successCount = 0;
      当天统计.failCount = 0;
      当天统计.date = 今天;
    }
    
    // 检查是否新的一周
    if (本周统计.weekStartDate !== 本周周一) {
      信息日志(`${账号前缀} [步骤7] 检测到新的一周，重置本周统计`);
      本周统计.challengeCount = 0;
      本周统计.successCount = 0;
      本周统计.failCount = 0;
      本周统计.initialTowerId = 当前towerId; // 记录本周初始层数
      本周统计.weekStartDate = 本周周一;
    }
    
    // 更新当前层数
    本周统计.currentTowerId = 当前towerId;
    信息日志(`${账号前缀} [步骤7] 统计初始化完成 - 当天: 挑战=${当天统计.challengeCount}, 成功=${当天统计.successCount}, 失败=${当天统计.failCount}`);
    信息日志(`${账号前缀} [步骤7] 统计初始化完成 - 本周: 挑战=${本周统计.challengeCount}, 成功=${本周统计.successCount}, 失败=${本周统计.failCount}, 初始层数=${格式化层数(本周统计.initialTowerId || 0)}, 当前层数=${格式化层数(本周统计.currentTowerId || 0)}`);
    
    // 8. 循环挑战（直到能量用完）
    信息日志(`${账号前缀} [步骤8] 开始循环挑战...`);
    let 挑战次数 = 0;
    let 成功次数 = 0;
    let 失败次数 = 0;
    let 最后状态 = 'pending';
    
    信息日志(`${账号前缀} [步骤8] 初始状态: 当前能量=${当前energy}, 当前层数=${格式化层数(当前towerId)}`);
    
    // ✅ 优化逻辑：上号时检查了能量数，理论上本次的能量数就代表了一定能循环多少次
    // 每次循环只需要检查是否需要领奖（防止执行失败因为未领奖将无法执行必须先领奖）
    // 循环次数用完后，重新检查能量数，如果=0就退出，如果还有能量（可能是完成-10层获得了10点能量）就继续循环
    
    while (true) {
      // ✅ 外层循环：每次开始前检查能量，确定本次循环次数
      信息日志(`${账号前缀} ========== 新一轮循环开始（检查能量） ==========`);
      
      // ✅ 步骤1：检查当前能量状态（确定本次循环次数）
      信息日志(`${账号前缀} [外层-步骤1] 检查当前能量状态，确定本次循环次数...`);
      
      // ✅ 先检查连接状态，确保账号在线
      信息日志(`${账号前缀} [外层-步骤1] 检查账号连接状态...`);
      const 连接正常 = await 检查并确保连接在线(账号前缀, tokenData);
      if (!连接正常) {
        错误日志(`${账号前缀} [外层-步骤1] ✗ 连接检查失败，无法继续执行，退出循环`);
        break; // 连接失败，退出循环
      }
      
      let 本次循环能量数 = 0;
      let 最新角色数据 = null;
      
      try {
        最新角色数据 = await 获取角色信息(账号前缀, tokenData, 3);
        await new Promise(resolve => setTimeout(resolve, 200));
        
        if (最新角色数据 && 最新角色数据.role && 最新角色数据.role.tower) {
          const 最新tower = 最新角色数据.role.tower;
          const 旧towerId = 当前towerId;
          const 旧energy = 当前energy;
          当前towerId = 最新tower.id;
          当前energy = 最新tower.energy;
          本次循环能量数 = 当前energy;
          
          信息日志(`${账号前缀} [外层-步骤1] 能量检查结果: 层数 ${格式化层数(旧towerId)} → ${格式化层数(当前towerId)}, 能量 ${旧energy} → ${当前energy}`);
          
          // ✅ 如果能量=0，退出循环
          if (当前energy <= 0) {
            信息日志(`${账号前缀} [外层-步骤1] ✗ 能量已用完（${当前energy}），停止挑战`);
            break;
          }
          
          // ✅ 检查是否卡在领奖界面（towerId % 10 === 0），并且需要领取奖励（检查reward对象）
          const 当前关卡号 = 当前towerId % 10;
          if (当前关卡号 === 0) {
            // 卡在-0关卡，需要检查是否已领取奖励
            const rewardId = Math.floor(当前towerId / 10); // 计算层数（如 1620 → 162）
            const 最新reward = 最新tower.reward || {};
            const 已领取层数列表 = Object.keys(最新reward).map(k => parseInt(k));
            const 需要领取奖励 = !已领取层数列表.includes(rewardId);
            
            if (需要领取奖励) {
              信息日志(`${账号前缀} [外层-步骤1] ⚠️ 检测到卡在领奖界面（${格式化层数(当前towerId)}），且未领取奖励，尝试领取：${rewardId}层...`);
              
              try {
                const claimResponse = await 发送指令('tower_claimreward', {
                  rewardId: rewardId
                }, `领取${rewardId}层奖励`, 10000, 账号前缀, tokenData);
                
                await new Promise(resolve => setTimeout(resolve, 1000)); // 等待1秒
                
                if (claimResponse) {
                  成功日志(`${账号前缀} [外层-步骤1] ✓ 奖励领取成功：${rewardId}层`);
                  // 领取成功后，重新获取角色信息以更新towerId（可能已经更新到下一层）
                  try {
                    const 领取后角色数据 = await 获取角色信息(账号前缀, tokenData, 3);
                    if (领取后角色数据 && 领取后角色数据.role && 领取后角色数据.role.tower) {
                      const 领取后tower = 领取后角色数据.role.tower;
                      const 领取前towerId = 当前towerId;
                      当前towerId = 领取后tower.id;
                      当前energy = 领取后tower.energy; // 可能增加了10点能量
                      本次循环能量数 = 当前energy; // 更新循环次数
                      信息日志(`${账号前缀} [外层-步骤1] 领取后状态更新: 层数 ${格式化层数(领取前towerId)} → ${格式化层数(当前towerId)}, 能量 ${旧energy} → ${当前energy}`);
                    }
                  } catch (recheckError) {
                    警告日志(`${账号前缀} [外层-步骤1] 领取后重新获取角色信息失败: ${recheckError.message}，继续执行`);
                  }
                } else {
                  警告日志(`${账号前缀} [外层-步骤1] ✗ 奖励领取可能失败，但继续执行（可能是已领取或网络问题）`);
                }
              } catch (claimError) {
                警告日志(`${账号前缀} [外层-步骤1] ✗ 奖励领取失败: ${claimError.message}，但继续执行`);
              }
              
              await new Promise(resolve => setTimeout(resolve, 200));
            } else {
              信息日志(`${账号前缀} [外层-步骤1] 检测到卡在领奖界面（${格式化层数(当前towerId)}），但奖励已领取（${rewardId}层在reward对象中），跳过领取`);
            }
          }
          
          信息日志(`${账号前缀} [外层-步骤1] ✓ 能量充足（${当前energy}），本次可循环 ${本次循环能量数} 次`);
        } else {
          警告日志(`${账号前缀} [外层-步骤1] 获取角色信息返回数据不完整`);
          break; // 数据不完整，退出
        }
      } catch (error) {
        // ✅ 重试3次后仍然失败，假设能量=0，记录状态，让6小时后再执行
        错误日志(`${账号前缀} [外层-步骤1] 获取能量信息失败（已重试3次）: ${error.message}`);
        警告日志(`${账号前缀} [外层-步骤1] 假设能量=0，记录状态，6小时后再执行`);
        当前energy = 0; // 假设能量=0
        break; // 退出循环，记录状态
      }
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // ✅ 内层循环：根据能量数循环挑战，循环中不需要检查能量（因为每次挑战消耗1点能量是必然的）
      // ✅ 奖励检查优化：从挑战响应中判断是否需要领奖（如果 towerId % 10 === 0，说明刚完成第10关）
      信息日志(`${账号前缀} [外层-步骤2] 开始内层循环，预计循环 ${本次循环能量数} 次...`);
      
      for (let 本次循环次数 = 0; 本次循环次数 < 本次循环能量数; 本次循环次数++) {
        // 计算下一关towerId并准备挑战
        const 下一关towerId = 当前towerId + 1;
        const 当前层数 = 格式化层数(当前towerId);
        const 目标层数 = 格式化层数(下一关towerId);
        
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // 发起挑战前检查连接状态
        const 挑战前连接正常 = await 检查并确保连接在线(账号前缀, tokenData);
        if (!挑战前连接正常) {
          错误日志(`${账号前缀} 连接失败，跳过挑战`);
          失败次数++;
          挑战次数++;
          当天统计.challengeCount++;
          当天统计.failCount++;
          本周统计.challengeCount++;
          本周统计.failCount++;
          当前energy = Math.max(0, 当前energy - 1);
          await new Promise(resolve => setTimeout(resolve, 200));
          continue;
        }
        
      const challengeResponse = await 发送指令('Fight_StartTower', {
        towerId: 下一关towerId
      }, `挑战${目标层数}`, 15000, 账号前缀, tokenData);
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
        if (!challengeResponse) {
          警告日志(`${账号前缀} 挑战超时`);
          失败次数++;
          挑战次数++;
          当天统计.challengeCount++;
          当天统计.failCount++;
          本周统计.challengeCount++;
          本周统计.failCount++;
          当前energy = Math.max(0, 当前energy - 1);
          await new Promise(resolve => setTimeout(resolve, 200));
          continue;
        }
        
      // 处理挑战响应
      let responseBody = null;
      if (challengeResponse.body) {
        responseBody = await 解析BON数据(challengeResponse.body);
        if (!responseBody.role && challengeResponse.body.role) {
          responseBody = challengeResponse.body;
        }
      } else if (challengeResponse.role) {
        responseBody = challengeResponse;
      } else {
        responseBody = await 解析BON数据(challengeResponse);
      }
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // 提取结果
      const 旧towerId = 当前towerId;
      const 旧层数 = 格式化层数(旧towerId);
      const 旧energy = 当前energy;
      const 新towerId = responseBody?.role?.tower?.id || 当前towerId;
      const 新层数 = 格式化层数(新towerId);
      
      let 新energy = responseBody?.role?.tower?.energy;
      if (新energy === undefined || 新energy === null) {
        新energy = Math.max(0, 当前energy - 1);
      } else if (新energy === 当前energy && 新towerId === 当前towerId) {
        新energy = Math.max(0, 当前energy - 1);
      }
      
      const isWin = responseBody?.battleData?.result?.isWin || false;
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
        // 判断成功/失败
        if (isWin === true) {
          成功日志(`${账号前缀} ✓ ${旧层数} → ${新层数}`);
          成功次数++;
        } else {
          警告日志(`${账号前缀} ✗ 挑战失败，停留在 ${旧层数}`);
          失败次数++;
        }
        
        挑战次数++;
        当前towerId = 新towerId;
        当前energy = 新energy;
        
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // 检查是否需要领取奖励（完成第10关）
        const 新关卡号 = 新towerId % 10;
        if (新关卡号 === 0) {
          const rewardId = Math.floor(新towerId / 10);
          try {
            const claimResponse = await 发送指令('tower_claimreward', {
              rewardId: rewardId
            }, `领取${rewardId}层奖励`, 10000, 账号前缀, tokenData);
            await new Promise(resolve => setTimeout(resolve, 1000));
            if (claimResponse && !claimResponse.error) {
              成功日志(`${账号前缀} ✓ 领取${rewardId}层奖励`);
            }
          } catch (claimError) {
            // 静默处理，可能已领取
          }
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        // 更新统计
        当天统计.challengeCount++;
        本周统计.challengeCount++;
        if (isWin) {
          当天统计.successCount++;
          本周统计.successCount++;
        } else {
          当天统计.failCount++;
          本周统计.failCount++;
        }
        
        本周统计.currentTowerId = 当前towerId;
        
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // 定期保存状态（每5次挑战保存一次）
        if (挑战次数 % 5 === 0) {
          try {
            更新账号状态(accountName, {
              tower: {
                towerId: 当前towerId,
                energy: 当前energy,
                today: 当天统计,
                week: 本周统计,
                status: 挑战次数 > 0 ? (失败次数 === 0 ? 'success' : (成功次数 === 0 ? 'failed' : 'partial')) : 'pending'
              }
            });
          } catch (saveError) {
            // 静默处理
          }
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      // 内层循环结束
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // 继续外层循环，重新检查能量（如果还有能量，可能是完成-10层获得了10点能量，继续循环）
    }
    
    // 9. 确定最终状态
    信息日志(`${账号前缀} [步骤9] 确定最终状态...`);
    信息日志(`${账号前缀} [步骤9] 挑战统计: 总次数=${挑战次数}, 成功=${成功次数}, 失败=${失败次数}`);
    信息日志(`${账号前缀} [步骤9] 最终状态: 层数=${格式化层数(当前towerId)}, 能量=${当前energy}`);
    信息日志(`${账号前缀} [步骤9] 最终统计 - 当天: 挑战=${当天统计.challengeCount}, 成功=${当天统计.successCount}, 失败=${当天统计.failCount}`);
    信息日志(`${账号前缀} [步骤9] 最终统计 - 本周: 挑战=${本周统计.challengeCount}, 成功=${本周统计.successCount}, 失败=${本周统计.failCount}, 初始层数=${格式化层数(本周统计.initialTowerId || 0)}, 当前层数=${格式化层数(本周统计.currentTowerId || 0)}`);
    
    if (挑战次数 === 0) {
      最后状态 = 'pending';
      // ✅ 如果挑战次数为0，说明能量为0或没有实际挑战，记录详细信息
      if (当前energy === 0) {
        信息日志(`${账号前缀} [步骤9] 状态判断: pending (能量为0，未进行任何挑战)`);
      } else {
        警告日志(`${账号前缀} [步骤9] 状态判断: pending (未进行挑战，但能量不为0（${当前energy}），可能存在问题)`);
      }
    } else if (失败次数 === 0) {
      最后状态 = 'success';
      信息日志(`${账号前缀} [步骤9] 状态判断: success (全部成功)`);
    } else if (成功次数 === 0) {
      最后状态 = 'failed';
      信息日志(`${账号前缀} [步骤9] 状态判断: failed (全部失败)`);
    } else {
      最后状态 = 'partial';
      信息日志(`${账号前缀} [步骤9] 状态判断: partial (部分成功)`);
    }
    
    // 10. 更新账号状态
    信息日志(`${账号前缀} [步骤10] 保存账号状态...`);
    const 保存时间 = new Date().toISOString();
    更新账号状态(accountName, {
      tower: {
        towerId: 当前towerId,
        energy: 当前energy,
        lastExecuteTime: 保存时间,
        today: 当天统计,
        week: 本周统计,
        status: 最后状态
      }
    });
    信息日志(`${账号前缀} [步骤10] 状态保存完成: 时间=${保存时间}, 状态=${最后状态}`);
    
    client.disconnect();
    
    const 执行时长 = Math.round((Date.now() - 开始时间) / 1000);
    
    // ✅ 能量为0是登录检测后的正常结果，任务已成功执行（检测了能量并记录了状态）
    // 只有在真正无法执行（如6小时内已执行、任务未启用）时才应该跳过
    信息日志(`${账号前缀} ========== 任务执行完成 ==========`);
    if (挑战次数 === 0) {
      if (当前energy === 0) {
        信息日志(`${账号前缀} [完成] 能量为0，已检测并记录状态`);
        信息日志(`${账号前缀} [完成] 最终状态: 层数=${格式化层数(当前towerId)}, 能量=${当前energy}, 耗时=${执行时长}秒`);
      } else {
        警告日志(`${账号前缀} [完成] 未进行挑战，但能量不为0（${当前energy}）`);
        警告日志(`${账号前缀} [完成] 最终状态: 层数=${格式化层数(当前towerId)}, 能量=${当前energy}, 耗时=${执行时长}秒`);
      }
    } else {
      成功日志(`${账号前缀} [完成] 挑战完成`);
      成功日志(`${账号前缀} [完成] 挑战统计: 总次数=${挑战次数}, 成功=${成功次数}, 失败=${失败次数}`);
      成功日志(`${账号前缀} [完成] 最终状态: 层数=${格式化层数(当前towerId)}, 能量=${当前energy}, 耗时=${执行时长}秒`);
    }
    信息日志(`${账号前缀} ==========================================`);
    信息日志('');
    
    // ✅ 无论是否有挑战，只要成功检测了能量并记录了状态，就返回 success: true
    return { 
      success: true, 
      name: accountName,
      challengeCount: 挑战次数,
      successCount: 成功次数,
      failCount: 失败次数,
      currentTowerId: 当前towerId,
      energy: 当前energy,
      duration: `${执行时长}秒`
    };
  } catch (error) {
    错误日志(`${账号前缀} [异常] 执行失败: ${error.message}`);
    错误日志(`${账号前缀} [异常] 错误堆栈: ${error.stack || '无堆栈信息'}`);
    
    // ✅ 异常退出时，尝试保存已更新的统计（如果有）
    try {
      信息日志(`${账号前缀} [异常处理] 开始保存异常退出前的数据...`);
      // 检查是否有已初始化的统计（说明至少进入了统计初始化阶段）
      if (当天统计 && 本周统计) {
        信息日志(`${账号前缀} [异常处理] 检测到已初始化的统计，保存统计数据`);
        // 更新当前层数（如果有）
        if (typeof 当前towerId !== 'undefined' && 当前towerId !== null) {
          本周统计.currentTowerId = 当前towerId;
        }
        
        信息日志(`${账号前缀} [异常处理] 异常前统计 - 当天: 挑战=${当天统计.challengeCount}, 成功=${当天统计.successCount}, 失败=${当天统计.failCount}`);
        信息日志(`${账号前缀} [异常处理] 异常前统计 - 本周: 挑战=${本周统计.challengeCount}, 成功=${本周统计.successCount}, 失败=${本周统计.failCount}`);
        
        // 保存已更新的统计
        const 保存时间 = new Date().toISOString();
        更新账号状态(accountName, {
          tower: {
            towerId: 当前towerId || 0,
            energy: (typeof 当前energy !== 'undefined' ? 当前energy : 0) || 0,
            lastExecuteTime: 保存时间,
            today: 当天统计,
            week: 本周统计,
            status: 'failed',
            error: `执行异常: ${error.message}`
          }
        });
        信息日志(`${账号前缀} [异常处理] 已保存异常退出前的统计数据: 时间=${保存时间}, 层数=${格式化层数(当前towerId || 0)}, 能量=${当前energy || 0}`);
      } else {
        信息日志(`${账号前缀} [异常处理] 未检测到已初始化的统计，保存基本信息`);
        // 如果没有统计，至少保存基本信息
        const 现有状态 = 获取账号状态(accountName);
        const 现有tower = 现有状态?.tower || {};
        信息日志(`${账号前缀} [异常处理] 现有状态: 层数=${格式化层数(现有tower.towerId || 0)}, 能量=${现有tower.energy || 0}`);
        
        更新账号状态(accountName, {
          tower: {
            towerId: 当前towerId || 现有tower.towerId || 0,
            energy: (typeof 当前energy !== 'undefined' ? 当前energy : 现有tower.energy) || 0,
            lastExecuteTime: new Date().toISOString(),
            today: 现有tower.today || { challengeCount: 0, successCount: 0, failCount: 0 },
            week: 现有tower.week || { challengeCount: 0, successCount: 0, failCount: 0, initialTowerId: null, currentTowerId: null, weekStartDate: null },
            status: 'failed',
            error: `执行异常: ${error.message}`
          }
        });
        信息日志(`${账号前缀} [异常处理] 已保存异常退出时的基本信息`);
      }
    } catch (saveError) {
      错误日志(`${账号前缀} [异常处理] 保存异常退出前的统计失败: ${saveError.message}`);
      错误日志(`${账号前缀} [异常处理] 保存错误堆栈: ${saveError.stack || '无堆栈信息'}`);
    }
    
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

// 切换阵容（失败时不阻塞，继续执行）
async function 切换阵容(目标阵容, 描述, 账号前缀, tokenData) {
  try {
    信息日志(`${账号前缀} ${描述}: 切换到阵容${目标阵容}`);
    const 结果 = await 发送指令('role_switchformation', { formationId: 目标阵容 }, `切换到${描述}`, 3000, 账号前缀, tokenData);
    
    // 检查是否有错误
    if (结果 && 结果.error) {
      const errorText = String(结果.error);
      if (errorText.includes('指令未实现') || errorText.includes('未实现')) {
        警告日志(`${账号前缀} 切换阵容失败: ${errorText}，可能爬塔不支持切换阵容，继续执行`);
        return false; // 返回false但不抛出错误
      }
    }
    
    if (结果 && 结果.cmd && !结果.cmd.includes('ack')) {
      成功日志(`${账号前缀} 阵容切换成功`);
      return true;
    }
    
    return false;
  } catch (error) {
    警告日志(`${账号前缀} 阵容切换失败: ${error.message}，继续执行`);
    return false; // 返回false但不抛出错误，不阻塞任务
  }
}

// 单账号模式（由调度器调用）
async function 执行单个账号模式(账号名称) {
  信息日志(`======== 单账号模式: ${账号名称} ========`);
  
  // ✅ 判断是否运行的唯一逻辑：
  // 1. 任务配置开关是否打开
  // 2. 近6小时未运行
  // 满足以上两个条件才执行，执行流程：登录 → 获取角色信息 → 判断能量 → 执行挑战
  
  // 读取tokens
  const tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf-8'));
  
  // 查找指定账号
  const tokenData = tokens.find(t => t.name === 账号名称);
  
  if (!tokenData) {
    错误日志(`未找到账号: ${账号名称}`);
    process.exit(1);
  }
  
  // 1. 检查任务是否启用（判断逻辑1：任务配置开关是否打开）
  if (!任务是否启用(账号名称, '咸将塔')) {
    警告日志(`咸将塔未启用，跳过`);
    process.exit(2); // 退出码2表示跳过
  }
  
  // 2. 检查6小时内是否已执行（判断逻辑2：近6小时未运行）
  const 所有账号状态 = 获取账号状态(账号名称);
  if (所有账号状态 && 所有账号状态.tower) {
    const 最后执行时间 = 所有账号状态.tower.lastExecuteTime;
    if (最后执行时间) {
      const 最后执行日期 = new Date(最后执行时间);
      const 现在 = new Date();
      const 时间间隔 = 现在.getTime() - 最后执行日期.getTime();
      const 间隔小时 = Math.floor(时间间隔 / (60 * 60 * 1000));
      
      // 如果6小时内已执行，跳过
      if (时间间隔 < 6 * 60 * 60 * 1000) {
        成功日志(`[${账号名称}] 6小时内已执行，跳过`);
        信息日志(`  跳过原因: 距离上次执行仅${间隔小时}小时，需等待6小时`);
        信息日志(`  上次执行时间: ${最后执行日期.toLocaleString('zh-CN')}`);
        process.exit(2); // 退出码2表示跳过，调度器不会更新执行记录
      }
    }
  }
  
  const result = await 执行塔挑战(tokenData, 0, 1);
  
  // ✅ 简化退出码：退出只有两种情况（获取不到能量值或能量用光），都已记录状态，统一返回成功
  if (result.success) {
    // 执行成功（无论是否有挑战，只要记录了状态就成功）
    成功日志('执行完成');
    if (result.challengeCount > 0) {
      信息日志(`  挑战: ${result.challengeCount}, 成功: ${result.successCount}, 失败: ${result.failCount}`);
    } else {
      信息日志(`  未进行挑战（${result.reason || '能量为0或获取不到能量值'}）`);
    }
    process.exit(0); // 退出码0表示成功执行（已记录状态）
  } else {
    // 执行失败（异常情况）
    警告日志(`执行失败: ${result.error || '未知错误'}`);
    process.exit(1); // 退出码1表示执行失败
  }
}

// 全账号模式（手动执行）
async function 执行全部账号模式() {
  信息日志('='.repeat(60));
  信息日志('开始执行全部账号的塔挑战任务');
  信息日志('='.repeat(60));
  信息日志('');
  
  const tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf-8'));
  const 总账号数 = tokens.length;
  
  let 成功数 = 0;
  let 失败数 = 0;
  let 跳过数 = 0;
  
  for (let i = 0; i < tokens.length; i++) {
    const tokenData = tokens[i];
    const accountName = tokenData.name;
    
    // ✅ 判断是否运行的唯一逻辑：
    // 1. 任务配置开关是否打开
    // 2. 近6小时未运行
    // 满足以上两个条件才执行，执行流程：登录 → 获取角色信息 → 判断能量 → 执行挑战
    
    // 1. 检查任务是否启用（判断逻辑1：任务配置开关是否打开）
    if (!任务是否启用(accountName, '咸将塔')) {
      信息日志(`[${i + 1}/${总账号数}] ${accountName} - 任务未启用，跳过`);
      跳过数++;
      continue;
    }
    
    // 2. 检查6小时内是否已执行（判断逻辑2：近6小时未运行）
    const 所有账号状态 = 获取账号状态(accountName);
    if (所有账号状态 && 所有账号状态.tower) {
      const 最后执行时间 = 所有账号状态.tower.lastExecuteTime;
      if (最后执行时间) {
        const 最后执行日期 = new Date(最后执行时间);
        const 现在 = new Date();
        const 时间间隔 = 现在.getTime() - 最后执行日期.getTime();
        const 间隔小时 = Math.floor(时间间隔 / (60 * 60 * 1000));
        
        // 如果6小时内已执行，跳过
        if (时间间隔 < 6 * 60 * 60 * 1000) {
          成功日志(`[账号${i + 1}/${总账号数}: ${accountName}] 6小时内已执行，跳过`);
          信息日志(`  跳过原因: 距离上次执行仅${间隔小时}小时，需等待6小时`);
          跳过数++;
          continue;
        }
      }
    }
    
    const result = await 执行塔挑战(tokenData, i, 总账号数);
    
    if (result.success) {
      成功数++;
    } else {
      失败数++;
    }
  }
  
  信息日志('');
  信息日志('='.repeat(60));
  信息日志(`执行完成: 成功 ${成功数}, 失败 ${失败数}, 跳过 ${跳过数}, 总计 ${总账号数}`);
  信息日志('='.repeat(60));
}

// 启动主函数
main();

export { 执行单个账号模式, 执行全部账号模式 };


