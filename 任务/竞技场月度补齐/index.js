/**
 * 竞技场月度补齐任务（独立版）
 * 执行频率: 每天一次
 * 说明: 独立的月度补齐任务，有自己的登录逻辑，不依赖每日竞技场任务
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketClient } from '../../工具/WebSocket客户端.js';
import { 成功日志, 错误日志, 警告日志, 信息日志, 清理过期日志 } from '../../工具/日志工具.js';
import { 今天已执行, 账号今天已执行, 开始执行, 完成执行, 清理过期执行记录, 更新账号记录 } from '../../工具/执行记录.js';
import { 获取账号配置, 任务是否启用 } from '../../工具/任务配置.js';
import { 更新竞技场状态 } from '../../工具/账号状态.js';
import { 通过WebSocket获取战斗版本, 获取战斗版本 } from '../../工具/获取战斗版本.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const 主配置 = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/config.json'), 'utf-8'));
const 任务配置 = JSON.parse(fs.readFileSync(path.join(__dirname, './配置.json'), 'utf-8'));

let client = null;

async function 发送指令(cmd, body = {}, 描述 = '', 延迟 = 500) {
  信息日志(`执行: ${描述 || cmd}`);
  return new Promise((resolve) => {
    let resolved = false;
    const timeoutId = setTimeout(() => { if (!resolved) { resolved = true; resolve(null); } }, 延迟);
    const messageHandler = (message) => {
      const cmdLower = cmd.toLowerCase().replace('_', '');
      const responseCmdLower = message.cmd ? message.cmd.toLowerCase().replace('_', '') : '';
      if (responseCmdLower.includes(cmdLower) || responseCmdLower.includes('resp')) {
        if (!resolved) { resolved = true; clearTimeout(timeoutId); client.off('message', messageHandler); resolve(message); }
      }
    };
    client.on('message', messageHandler);
    client.send(cmd, body);
  });
}

async function 切换阵容(目标阵容, 描述) {
  let 原始阵容ID = null;
  try {
    信息日志(`${描述}: 获取当前阵容信息...`);
    const 阵容信息响应 = await 发送指令('presetteam_getinfo', {}, `获取${描述}阵容信息`, 3000);
    if (阵容信息响应?.body) {
      let 阵容数据 = 阵容信息响应.body;
      if (阵容数据 instanceof Uint8Array) {
        const { bon } = await import('../../工具/BON协议.js');
        阵容数据 = bon.decode(阵容数据);
      }
      原始阵容ID = 阵容数据?.presetTeamInfo?.useTeamId;
      if (原始阵容ID !== undefined && 原始阵容ID !== null) {
        信息日志(`${描述}: 当前使用阵容ID: ${原始阵容ID}`);
      }
    }
    信息日志(`${描述}: 切换到阵容${目标阵容}`);
    await 发送指令('presetteam_saveteam', { teamId: 目标阵容 }, `切换到${描述}`, 3000);
    成功日志(`${描述}: 阵容切换完成`);
  } catch (error) {
    警告日志(`阵容切换失败: ${error.message}`);
  }
  return 原始阵容ID;
}

async function 恢复原始阵容(原始阵容ID, 描述) {
  if (原始阵容ID === null || 原始阵容ID === undefined) return;
  try {
    信息日志(`${描述}: 恢复原始阵容ID: ${原始阵容ID}`);
    await 发送指令('presetteam_saveteam', { teamId: 原始阵容ID }, `恢复${描述}原始阵容`, 3000);
    成功日志(`${描述}: 原始阵容恢复完成`);
  } catch (error) {
    警告日志(`${描述}: 恢复原始阵容失败: ${error.message}`);
  }
}


async function 执行月度补齐(账号前缀 = '', 账号名称 = '') {
  const prefix = 账号前缀 ? `${账号前缀} ` : '';
  let 原始阵容ID = null;
  
  try {
    信息日志('');
    信息日志(`${prefix}=== 开始执行竞技场月度补齐 ===`);
    信息日志('');
    
    // 检查时间
    const hour = new Date().getHours();
    if (hour < 8) { 警告日志(`${prefix}当前时间未到8点，跳过`); return { success: false, reason: '时间未到' }; }
    if (hour >= 22) { 警告日志(`${prefix}当前时间已过22点，竞技场已关闭`); return { success: false, reason: '竞技场已关闭' }; }
    
    // 获取配置（从竞技场配置读取阵容等设置）
    let 设置 = 任务配置.设置;
    if (账号名称) {
      const 账号竞技场配置 = 获取账号配置(账号名称, '竞技场');
      if (账号竞技场配置) {
        设置 = { ...设置, ...账号竞技场配置 };
      }
    }
    
    const { bon } = await import('../../工具/BON协议.js');
    
    // 发送随机数种子
    信息日志(`${prefix}[1/3] 获取角色信息并发送随机数种子`);
    const roleInfoResp = await 发送指令('role_getroleinfo', {}, `${prefix}获取角色信息`, 3000);
    let roleInfo = roleInfoResp;
    if (roleInfoResp?.body && roleInfoResp.body instanceof Uint8Array) {
      roleInfo = bon.decode(roleInfoResp.body);
    } else if (roleInfoResp?.body && typeof roleInfoResp.body === 'object') {
      const keys = Object.keys(roleInfoResp.body).map(k => parseInt(k)).sort((a, b) => a - b);
      if (keys.length > 0 && keys[0] === 0) {
        const arr = new Uint8Array(keys.length);
        keys.forEach((k, i) => arr[i] = roleInfoResp.body[k]);
        roleInfo = bon.decode(arr);
      }
    }
    
    const statistics = roleInfo?.role?.statistics;
    const lastLoginTime = statistics?.['last:login:time'] || statistics?.lastLoginTime || 0;
    
    if (lastLoginTime) {
      const XOR_A = 2118920861, XOR_B = 797788954, XOR_C = 1513922175;
      let seed = lastLoginTime | 0;
      seed ^= XOR_A;
      seed = ((seed << 16) | (seed >>> 16)) >>> 0;
      seed ^= XOR_B;
      seed ^= XOR_C;
      const randomSeed = seed >>> 0;
      信息日志(`${prefix}登录时间: ${lastLoginTime}, 随机种子: ${randomSeed}`);
      try { await 发送指令('system_custom', { key: 'randomSeed', value: randomSeed }, `${prefix}发送随机种子`, 500); } catch (e) {}
      成功日志(`${prefix}随机数种子已发送`);
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    // 获取战斗版本
    信息日志(`${prefix}获取最新战斗版本号...`);
    let battleVersion = null;
    try {
      battleVersion = await 通过WebSocket获取战斗版本(client);
      信息日志(`${prefix}WebSocket获取版本号: ${battleVersion}`);
    } catch (e) {
      警告日志(`${prefix}WebSocket获取版本号失败: ${e.message}`);
    }
    if (!battleVersion) {
      信息日志(`${prefix}尝试HTTP方式获取版本号...`);
      battleVersion = await 获取战斗版本();
    }
    信息日志(`${prefix}当前战斗版本: ${battleVersion}`);
    
    // 获取月度进度
    信息日志(`${prefix}[2/3] 检测月度进度...`);
    const 活动响应 = await 发送指令('activity_get', {}, `${prefix}获取月度进度`, 10000);
    let 活动数据 = null;
    if (活动响应?.body) {
      活动数据 = 活动响应.body instanceof Uint8Array ? bon.decode(活动响应.body) : 活动响应.body;
    }
    
    const 竞技场进度 = Number(活动数据?.activity?.myArenaInfo?.num || 0);
    const ARENA_TARGET = 设置.月度目标 || 240;
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();
    const remainingDays = daysInMonth - dayOfMonth;
    const 应达进度 = remainingDays <= 2 ? ARENA_TARGET : Math.min(ARENA_TARGET, Math.ceil((dayOfMonth / daysInMonth) * ARENA_TARGET));
    const 需要补齐 = Math.max(0, 应达进度 - 竞技场进度);
    
    信息日志(`${prefix}当前进度: ${竞技场进度}/${ARENA_TARGET}，应达: ${应达进度}，需补齐: ${需要补齐}`);
    更新竞技场状态(账号名称, { 月度进度: 竞技场进度, 月度目标: ARENA_TARGET, 月度应达: 应达进度, 月度更新: new Date().toISOString() });
    
    if (需要补齐 <= 0) {
      成功日志(`${prefix}进度已达标，无需补齐`);
      return { success: true, reason: '进度已达标', 当前进度: 竞技场进度, 应达进度 };
    }
    
    // 切换阵容
    const 阵容切换启用 = 设置.阵容切换 === true;
    if (阵容切换启用) {
      原始阵容ID = await 切换阵容(设置.竞技场阵容 || 1, '竞技场阵容');
    }
    
    // 开始补齐战斗（外循环检查进度，内循环执行战斗）
    信息日志(`${prefix}[3/3] 开始补齐战斗`);
    await 发送指令('arena_startarea', {}, `${prefix}开始竞技场`, 1000);
    
    let 总战斗次数 = 0;
    const 最大轮次 = 3;  // 最多检查3轮，正常1轮就够
    
    for (let 轮次 = 1; 轮次 <= 最大轮次; 轮次++) {
      // 外循环：获取最新进度，计算需要补齐的分数
      const 进度响应 = await 发送指令('activity_get', {}, `${prefix}获取当前进度`, 10000);
      let 进度数据 = null;
      if (进度响应?.body) {
        进度数据 = 进度响应.body instanceof Uint8Array ? bon.decode(进度响应.body) : 进度响应.body;
      }
      const 当前进度 = Number(进度数据?.activity?.myArenaInfo?.num || 0);
      const 本轮需要补齐 = Math.max(0, 应达进度 - 当前进度);
      
      // 假设每场战斗平均得1.5分，计算需要的战斗场数
      const 本轮需要战斗场数 = Math.ceil(本轮需要补齐 / 1.5);
      
      信息日志(`${prefix}第${轮次}轮: 当前进度 ${当前进度}/${ARENA_TARGET}，应达 ${应达进度}，需补齐 ${本轮需要补齐} 分，约 ${本轮需要战斗场数} 场`);
      
      // 更新状态
      更新竞技场状态(账号名称, { 月度进度: 当前进度, 月度目标: ARENA_TARGET, 月度应达: 应达进度, 月度更新: new Date().toISOString() });
      
      // 检查是否达标
      if (本轮需要补齐 <= 0) {
        成功日志(`${prefix}进度已达标，停止补齐`);
        break;
      }
      
      // 内循环：执行本轮需要的战斗场数
      let 本轮已战斗 = 0;
      while (本轮已战斗 < 本轮需要战斗场数) {
        try {
          const targets = await 发送指令('arena_getareatarget', { refresh: false }, `${prefix}获取目标`, 8000);
          let 目标数据 = null;
          if (targets?.body) { 目标数据 = targets.body instanceof Uint8Array ? bon.decode(targets.body) : targets.body; }
          const targetId = 目标数据?.roleList?.[0]?.roleId;
          if (!targetId) { 警告日志(`${prefix}未找到可用目标，停止本轮`); break; }
          
          const targetName = 目标数据?.roleList?.[0]?.roleName || targetId;
          信息日志(`${prefix}目标: ${targetName}`);
          
          await 发送指令('fight_startareaarena', { targetId, battleVersion }, `${prefix}战斗 ${本轮已战斗 + 1}/${本轮需要战斗场数}`, 15000);
          本轮已战斗++;
          总战斗次数++;
          await new Promise(r => setTimeout(r, 1200));
        } catch (e) {
          警告日志(`${prefix}战斗失败: ${e.message}`);
          break;
        }
      }
      
      信息日志(`${prefix}第${轮次}轮完成，本轮战斗 ${本轮已战斗} 场`);
    }
    
    // 恢复阵容
    if (原始阵容ID !== null && 原始阵容ID !== undefined) {
      await 恢复原始阵容(原始阵容ID, '竞技场阵容');
    }
    
    // 获取最终进度判断结果
    const 最终响应 = await 发送指令('activity_get', {}, `${prefix}获取最终进度`, 10000);
    let 最终数据 = null;
    if (最终响应?.body) { 最终数据 = 最终响应.body instanceof Uint8Array ? bon.decode(最终响应.body) : 最终响应.body; }
    const 最终进度 = Number(最终数据?.activity?.myArenaInfo?.num || 0);
    
    // 更新最终进度
    更新竞技场状态(账号名称, { 月度进度: 最终进度, 月度目标: ARENA_TARGET, 月度应达: 应达进度, 月度更新: new Date().toISOString() });
    
    if (最终进度 >= 应达进度) {
      成功日志(`${prefix}补齐完成，共战斗 ${总战斗次数} 次，最终进度: ${最终进度}/${ARENA_TARGET}`);
      return { success: true, reason: '补齐完成', 战斗次数: 总战斗次数 };
    } else {
      警告日志(`${prefix}补齐未完成，共战斗 ${总战斗次数} 次，最终进度: ${最终进度}/${ARENA_TARGET}`);
      return { success: false, reason: '补齐未完成', 战斗次数: 总战斗次数 };
    }
  } catch (error) {
    错误日志(`${prefix}执行月度补齐异常: ${error.message}`);
    if (原始阵容ID !== null && 原始阵容ID !== undefined) {
      try { await 恢复原始阵容(原始阵容ID, '竞技场阵容'); } catch (e) {}
    }
    throw error;
  }
}


async function 执行单个账号(tokenData, 账号索引, 总账号数) {
  const 账号前缀 = `[账号${账号索引 + 1}/${总账号数}: ${tokenData.name}]`;
  const 开始时间 = Date.now();
  
  try {
    信息日志(`${账号前缀} 正在连接...`);
    client = new WebSocketClient(主配置.wsServer, tokenData.token);
    await client.connect();
    成功日志(`${账号前缀} 连接成功！`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const 任务结果 = await 执行月度补齐(账号前缀, tokenData.name);
    
    client.disconnect();
    const 执行时长 = Math.round((Date.now() - 开始时间) / 1000);
    
    if (任务结果?.success) {
      成功日志(`${账号前缀} 任务执行完毕 ✓ ${任务结果.reason} (耗时: ${执行时长}秒)`);
    } else {
      警告日志(`${账号前缀} 任务执行完毕 ⚠ ${任务结果?.reason || '未知'} (耗时: ${执行时长}秒)`);
    }
    信息日志('');
    
    return {
      success: 任务结果?.success || false,
      name: tokenData.name,
      duration: `${执行时长}秒`,
      reason: 任务结果?.reason || '未知',
      战斗次数: 任务结果?.战斗次数 || 0
    };
  } catch (error) {
    错误日志(`${账号前缀} 执行失败: ${error.message}`);
    if (client) { client.disconnect(); }
    return {
      success: false,
      name: tokenData.name,
      error: error.message,
      duration: `${Math.round((Date.now() - 开始时间) / 1000)}秒`
    };
  }
}

async function main() {
  try {
    const 强制执行 = process.argv.includes('--force') || process.argv.includes('-f');
    const accountIndex = process.argv.indexOf('--account');
    const 指定账号 = accountIndex !== -1 ? process.argv[accountIndex + 1] : null;
    
    if (指定账号) {
      await 执行单个账号模式(指定账号);
    } else {
      await 执行全部账号模式(强制执行);
    }
  } catch (error) {
    错误日志('执行失败:', error.message);
    console.error(error);
    process.exit(1);
  }
}

async function 执行单个账号模式(账号名称) {
  信息日志(`======== 单账号模式: ${账号名称} ========`);
  
  const tokensFile = path.join(__dirname, '../../', 主配置.tokensFile);
  const tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf-8'));
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
  
  if (!任务是否启用(账号名称, '竞技场')) {
    警告日志(`竞技场任务未启用，跳过`);
    process.exit(0);
  }
  
  // 检查月度补齐开关
  const 账号竞技场配置 = 获取账号配置(账号名称, '竞技场');
  if (!账号竞技场配置 || 账号竞技场配置.月度补齐 !== true) {
    警告日志(`竞技场月度补齐未启用，跳过`);
    process.exit(0);
  }
  
  const result = await 执行单个账号(tokenData, 0, 1);
  更新账号记录(result.name, {
    status: result.success ? 'success' : 'failed',
    error: result.error || null,
    duration: result.duration || '0秒',
    reason: result.reason || '未知'
  });
  
  if (result.success) {
    成功日志('执行完成');
    process.exit(0);
  } else {
    错误日志(`执行失败: ${result.error || result.reason}`);
    process.exit(1);
  }
}

async function 执行全部账号模式(强制执行) {
  try {
    信息日志('='.repeat(60));
    信息日志('           竞技场月度补齐任务');
    if (强制执行) { 警告日志('           （强制执行模式）'); }
    信息日志('='.repeat(60));
    信息日志('');
    
    信息日志('步骤1: 清理过期文件...');
    清理过期日志();
    清理过期执行记录();
    信息日志('');
    
    信息日志('步骤2: 检查执行状态...');
    if (!强制执行 && 今天已执行()) {
      警告日志('今天已经执行过，跳过执行');
      process.exit(0);
    }
    if (强制执行) { 警告日志('强制执行模式，忽略今日执行检查'); }
    else { 成功日志('今天还未执行，开始执行任务'); }
    信息日志('');
    
    const tokensFile = path.join(__dirname, '../../', 主配置.tokensFile);
    const tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf-8'));
    if (tokens.length === 0) {
      错误日志('没有可用的Token');
      process.exit(1);
    }
    
    信息日志(`任务: ${任务配置.任务名称}`);
    信息日志(`频率: ${任务配置.执行频率}`);
    信息日志(`总计 ${tokens.length} 个账号`);
    信息日志('');
    信息日志('开始顺序执行...');
    信息日志('');
    
    const results = [];
    let hasAnyExecution = false;
    
    for (let i = 0; i < tokens.length; i++) {
      const tokenData = tokens[i];
      const accountName = tokenData.name;
      
      const 账号配置 = 获取账号配置(accountName);
      if (!账号配置 || !账号配置.启用) {
        警告日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 账号未启用，跳过`);
        results.push({ success: false, name: accountName, error: '账号未启用' });
        continue;
      }
      
      if (!任务是否启用(accountName, '竞技场')) {
        警告日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 竞技场任务未启用，跳过`);
        results.push({ success: false, name: accountName, error: '竞技场任务未启用' });
        continue;
      }
      
      // 检查月度补齐开关
      const 账号竞技场配置 = 获取账号配置(accountName, '竞技场');
      if (!账号竞技场配置 || 账号竞技场配置.月度补齐 !== true) {
        警告日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 竞技场月度补齐未启用，跳过`);
        results.push({ success: false, name: accountName, error: '月度补齐未启用' });
        continue;
      }
      
      if (!强制执行 && 账号今天已执行(accountName)) {
        警告日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 今天已执行过，跳过`);
        results.push({ success: true, name: accountName, error: '今天已执行' });
        continue;
      }
      
      if (!hasAnyExecution) {
        开始执行();
        hasAnyExecution = true;
      }
      
      const result = await 执行单个账号(tokenData, i, tokens.length);
      results.push(result);
      更新账号记录(result.name, {
        status: result.success ? 'success' : 'failed',
        error: result.error || null,
        duration: result.duration || '0秒',
        reason: result.reason || '未知'
      });
    }
    
    const 成功 = results.filter(r => r.success).length;
    const 失败 = results.filter(r => !r.success).length;
    
    信息日志('');
    信息日志('='.repeat(60));
    成功日志(`所有账号执行完毕！成功: ${成功}, 失败: ${失败}`);
    if (失败 > 0) {
      错误日志('失败账号:');
      results.filter(r => !r.success).forEach(r => {
        错误日志(`  - ${r.name}: ${r.error || r.reason}`);
      });
    }
    信息日志('='.repeat(60));
    信息日志('');
    
    完成执行(tokens.length, 成功, 失败, {});
    成功日志('执行记录已保存');
  } catch (error) {
    错误日志('执行失败:', error.message);
    console.error(error);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  信息日志('');
  信息日志('正在退出...');
  if (client) { client.disconnect(); }
  process.exit(0);
});

main();
