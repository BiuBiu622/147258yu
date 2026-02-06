/**
 * 竞技场任务
 * 执行频率: 每天一次（8:00-22:00）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketClient } from '../../工具/WebSocket客户端.js';
import { 成功日志, 错误日志, 警告日志, 信息日志, 清理过期日志 } from '../../工具/日志工具.js';
import { 今天已执行, 账号今天已执行, 开始执行, 完成执行, 清理过期执行记录, 更新账号记录 } from '../../工具/执行记录.js';
import { 获取账号配置, 任务是否启用 } from '../../工具/任务配置.js';
import { 更新竞技场状态, 更新账号状态, 从角色信息提取状态 } from '../../工具/账号状态.js';
import { 获取战斗版本, 通过WebSocket获取战斗版本 } from '../../工具/获取战斗版本.js';

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
      } else if (typeof 阵容数据 === 'object' && !阵容数据.presetTeamInfo) {
        const keys = Object.keys(阵容数据).map(k => parseInt(k)).sort((a, b) => a - b);
        if (keys.length > 0 && keys[0] === 0) {
          const arr = new Uint8Array(keys.length);
          keys.forEach((k, i) => arr[i] = 阵容数据[k]);
          const { bon } = await import('../../工具/BON协议.js');
          阵容数据 = bon.decode(arr);
        }
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

async function 执行竞技场任务(账号前缀 = '', 账号名称 = '') {
  const prefix = 账号前缀 ? `${账号前缀} ` : '';
  let 原始阵容ID = null;

  try {
    信息日志('');
    信息日志(`${prefix}=== 开始执行竞技场任务 ===`);
    信息日志('');

    //  动态获取战斗版本号 
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

    let 设置;
    if (账号名称) {
      const 账号任务配置 = 获取账号配置(账号名称, '竞技场');
      设置 = 账号任务配置 || 任务配置.设置;
      信息日志(`${prefix}使用配置: ${账号任务配置 ? '账号配置' : '默认配置'}`);
    } else {
      设置 = 任务配置.设置;
      信息日志(`${prefix}使用默认配置`);
    }

    const hour = new Date().getHours();
    if (hour < 8) { 警告日志(`${prefix}当前时间未到8点，跳过竞技场任务`); return { success: false, successCount: 0, reason: '时间未到' }; }
    if (hour >= 22) { 警告日志(`${prefix}当前时间已过22点，竞技场已关闭`); return { success: false, successCount: 0, reason: '竞技场已关闭' }; }

    信息日志(`${prefix}[1/3] 获取角色信息并发送随机数种子`);
    const { bon } = await import('../../工具/BON协议.js');

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
      try { await 发送指令('system_custom', { key: 'randomSeed', value: randomSeed }, `${prefix}发送随机种子`, 500); } catch (e) { }
      成功日志(`${prefix}随机数种子已发送`);
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    信息日志(`${prefix}[2/3] 竞技场战斗`);

    const 阵容切换启用 = 设置.阵容切换 === true;
    if (阵容切换启用) {
      原始阵容ID = await 切换阵容(设置.竞技场阵容 || 1, '竞技场阵容');
    } else {
      信息日志(`${prefix}阵容切换已关闭，跳过切换阵容`);
    }

    let 成功次数 = 0;
    const 战斗次数 = 设置.战斗次数 || 3;

    信息日志(`${prefix}将进行${战斗次数}次竞技场战斗`);
    await 发送指令('arena_startarea', {}, `${prefix}开始竞技场`, 1000);

    for (let i = 0; i < 战斗次数; i++) {
      信息日志(`${prefix}竞技场战斗 第${i + 1}次 (已成功${成功次数}/${战斗次数})`);

      try {
        const targets = await 发送指令('arena_getareatarget', { refresh: false }, `${prefix}获取目标`, 1500);
        let 目标数据 = null;
        if (targets?.body) {
          目标数据 = targets.body instanceof Uint8Array ? bon.decode(targets.body) : targets.body;
        }

        const targetId = 目标数据?.roleList?.[0]?.roleId;
        const targetRank = 目标数据?.roleList?.[0]?.rank || 0;
        const targetScore = 目标数据?.roleList?.[0]?.score || 0;

        if (!targetId) { 警告日志(`${prefix}第${i + 1}次战斗 - 获取目标失败`); break; }

        信息日志(`${prefix}目标: ${目标数据.roleList[0].roleName || targetId} (排名:${targetRank}, 分数:${targetScore})`);

        //  战斗（只传 targetId 和 battleVersion）
        const 战斗结果 = await 发送指令('fight_startareaarena', { targetId, battleVersion }, `${prefix}战斗中...`, 15000);

        if (战斗结果 && 战斗结果.cmd && !战斗结果.cmd.includes('ack')) {
          成功次数++;
          成功日志(`${prefix}✓ 第${i + 1}次战斗成功 (已成功${成功次数}/${战斗次数})`);
        } else {
          警告日志(`${prefix}✗ 第${i + 1}次战斗失败或超时 (收到: ${战斗结果?.cmd || 'null'})`);
        }
      } catch (error) {
        错误日志(`${prefix}第${i + 1}次战斗异常: ${error.message}`);
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    if (成功次数 >= 战斗次数) { 成功日志(`${prefix}竞技场战斗完成 ✓ 成功${成功次数}次`); }
    else if (成功次数 > 0) { 警告日志(`${prefix}竞技场战斗部分成功 - 成功${成功次数}次`); }
    else { 错误日志(`${prefix}竞技场战斗全部失败`); }
    信息日志('');

    // 月度补齐已移至独立任务：任务/竞技场月度补齐/index.js

    信息日志(`${prefix}[3/3] 领取活跃奖励`);
    for (let taskId = 1; taskId <= 10; taskId++) { await 发送指令('task_claimdailypoint', { taskId }, `${prefix}领取日活跃奖励${taskId}`, 500); }
    await 发送指令('task_claimdailyreward', {}, `${prefix}领取日常任务奖励`, 500);
    await 发送指令('task_claimweekreward', {}, `${prefix}领取周常任务奖励`, 500);
    成功日志(`${prefix}活跃奖励领取完成`);
    信息日志('');

    if (原始阵容ID !== null && 原始阵容ID !== undefined) { await 恢复原始阵容(原始阵容ID, '竞技场阵容'); }

    信息日志('');
    成功日志(`${prefix}=== 竞技场任务执行完成 ===`);
    信息日志('');

    return { success: 成功次数 >= 战斗次数, successCount: 成功次数, attemptCount: 战斗次数, reason: 成功次数 >= 战斗次数 ? '完成' : `仅成功${成功次数}次` };
  } catch (error) {
    错误日志(`${prefix}执行竞技场任务异常: ${error.message}`);
    if (原始阵容ID !== null && 原始阵容ID !== undefined) { try { await 恢复原始阵容(原始阵容ID, '竞技场阵容'); } catch (e) { } }
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

    const 任务结果 = await 执行竞技场任务(账号前缀, tokenData.name);

    信息日志(`${账号前缀} 获取角色信息以更新每日任务进度...`);
    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      const 角色信息响应 = await 发送指令('role_getroleinfo', { clientVersion: '1.65.3-wx', inviteUid: 0, platform: 'hortor', platformExt: 'mix', scene: '' }, `${账号前缀} 获取角色信息`, 5000);
      if (角色信息响应?.body) {
        let 角色数据 = 角色信息响应.body;
        if (角色数据 instanceof Uint8Array) { const { bon } = await import('../../工具/BON协议.js'); 角色数据 = bon.decode(角色数据); }
        else if (typeof 角色数据 === 'object' && !角色数据.role) {
          const keys = Object.keys(角色数据).map(k => parseInt(k)).sort((a, b) => a - b);
          if (keys.length > 0 && keys[0] === 0) { const arr = new Uint8Array(keys.length); keys.forEach((k, i) => arr[i] = 角色数据[k]); const { bon } = await import('../../工具/BON协议.js'); 角色数据 = bon.decode(arr); }
        }
        if (角色数据?.role) {
          const 状态数据 = 从角色信息提取状态(角色数据, ['dailyTask']);
          if (状态数据?.dailyTask) { 信息日志(`${账号前缀} 当前每日任务进度: ${状态数据.dailyTask.dailyPoint || 0}/110`); 更新账号状态(tokenData.name, 状态数据); }
        }
      }
    } catch (error) { 警告日志(`${账号前缀} 获取每日任务进度失败: ${error.message}`); }

    client.disconnect();
    const 执行时长 = Math.round((Date.now() - 开始时间) / 1000);

    if (任务结果?.success) { 成功日志(`${账号前缀} 任务执行完毕 ✓ 成功${任务结果.successCount}次 (耗时: ${执行时长}秒)`); }
    else { 警告日志(`${账号前缀} 任务执行完毕 ⚠ 成功${任务结果?.successCount || 0}次 (耗时: ${执行时长}秒)`); }
    信息日志('');

    更新竞技场状态(tokenData.name, { successCount: 任务结果?.successCount || 0, attemptCount: 任务结果?.attemptCount || 0, status: 任务结果?.success ? 'success' : (任务结果?.successCount > 0 ? 'partial' : 'failed') });

    return { success: 任务结果?.success || false, name: tokenData.name, duration: `${执行时长}秒`, successCount: 任务结果?.successCount || 0, attemptCount: 任务结果?.attemptCount || 0, reason: 任务结果?.reason || '未知' };
  } catch (error) {
    错误日志(`${账号前缀} 执行失败: ${error.message}`);
    if (client) { client.disconnect(); }
    return { success: false, name: tokenData.name, error: error.message, duration: `${Math.round((Date.now() - 开始时间) / 1000)}秒` };
  }
}

async function main() {
  try {
    const 强制执行 = process.argv.includes('--force') || process.argv.includes('-f');
    const accountIndex = process.argv.indexOf('--account');
    const 指定账号 = accountIndex !== -1 ? process.argv[accountIndex + 1] : null;
    if (指定账号) { await 执行单个账号模式(指定账号); }
    else { await 执行全部账号模式(强制执行); }
  } catch (error) { 错误日志('执行失败:', error.message); console.error(error); process.exit(1); }
}

async function 执行单个账号模式(账号名称) {
  信息日志(`======== 单账号模式: ${账号名称} ========`);
  const tokensFile = path.join(__dirname, '../../', 主配置.tokensFile);
  const tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf-8'));
  const tokenData = tokens.find(t => t.name === 账号名称);
  if (!tokenData) { 错误日志(`未找到账号: ${账号名称}`); process.exit(1); }
  const 账号配置 = 获取账号配置(账号名称);
  if (!账号配置 || !账号配置.启用) { 警告日志(`账号未启用，跳过`); process.exit(0); }
  if (!任务是否启用(账号名称, '竞技场')) { 警告日志(`竞技场任务未启用，跳过`); process.exit(0); }

  const result = await 执行单个账号(tokenData, 0, 1);
  更新账号记录(result.name, { status: result.success ? 'success' : (result.successCount > 0 ? 'partial' : 'failed'), error: result.error || null, duration: result.duration || '0秒', successCount: result.successCount || 0, attemptCount: result.attemptCount || 0 });

  // 无论成功、部分成功还是失败，都记录执行时间，当天跳过不再重试
  if (result.success) {
    成功日志('执行完成');
  } else if (result.successCount > 0) {
    警告日志(`部分成功：成功${result.successCount}次，已记录执行时间`);
  } else {
    错误日志(`执行失败: ${result.error || '全部失败'}，已记录执行时间，当天跳过`);
  }
  process.exit(0); // 统一返回0，记录执行时间，当天不再重试
}

async function 执行全部账号模式(强制执行) {
  try {
    信息日志('='.repeat(60));
    信息日志('           竞技场任务自动执行系统');
    if (强制执行) { 警告日志('           （强制执行模式）'); }
    信息日志('='.repeat(60));
    信息日志('');

    信息日志('步骤1: 清理过期文件...');
    清理过期日志();
    清理过期执行记录();
    信息日志('');

    信息日志('步骤2: 检查执行状态...');
    if (!强制执行 && 今天已执行()) { 警告日志('今天已经执行过，跳过执行'); process.exit(0); }
    if (强制执行) { 警告日志('强制执行模式，忽略今日执行检查'); }
    else { 成功日志('今天还未执行，开始执行任务'); }
    信息日志('');

    const tokensFile = path.join(__dirname, '../../', 主配置.tokensFile);
    const tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf-8'));
    if (tokens.length === 0) { 错误日志('没有可用的Token'); process.exit(1); }

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
      if (!账号配置 || !账号配置.启用) { 警告日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 账号未启用，跳过`); results.push({ success: false, name: accountName, error: '账号未启用' }); continue; }
      if (!任务是否启用(accountName, '竞技场')) { 警告日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 竞技场任务未启用，跳过`); results.push({ success: false, name: accountName, error: '竞技场任务未启用' }); continue; }
      if (!强制执行 && 账号今天已执行(accountName)) { 警告日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 今天已执行过，跳过`); results.push({ success: true, name: accountName, error: '今天已执行' }); continue; }
      if (!hasAnyExecution) { 开始执行(); hasAnyExecution = true; }

      const result = await 执行单个账号(tokenData, i, tokens.length);
      results.push(result);
      更新账号记录(result.name, { status: result.success ? 'success' : (result.successCount > 0 ? 'partial' : 'failed'), error: result.error || null, duration: result.duration || '0秒', successCount: result.successCount || 0, attemptCount: result.attemptCount || 0 });
    }

    const 成功 = results.filter(r => r.success).length;
    const 失败 = results.filter(r => !r.success).length;

    信息日志('');
    信息日志('='.repeat(60));
    成功日志(`所有账号执行完毕！成功: ${成功}, 失败: ${失败}`);
    if (失败 > 0) { 错误日志('失败账号:'); results.filter(r => !r.success).forEach(r => { 错误日志(`  - ${r.name}: ${r.error}`); }); }
    信息日志('='.repeat(60));
    信息日志('');

    完成执行(tokens.length, 成功, 失败, {});
    成功日志('执行记录已保存');
  } catch (error) { 错误日志('执行失败:', error.message); console.error(error); process.exit(1); }
}

process.on('SIGINT', () => { 信息日志(''); 信息日志('正在退出...'); if (client) { client.disconnect(); } process.exit(0); });

main();

