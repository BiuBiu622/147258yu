/**
 * 咸王宝库任务 - 主程序
 * 执行频率: 每周5次（周三至周日，周一周二不开放）
 * 
 * 任务流程:
 * - 第1层：打BOSS（最多3次），打不死发布助战
 * - 第2层：打BOSS（最多3次），打不死发布助战
 * - 第3层：用钥匙攻击（最多10次），BOSS死后领取6个奖励
 * - 第4层：打BOSS（最多3次），打不死发布助战
 * - 第5层：打BOSS（最多3次），打不死发布助战
 * - 第6层：不管（需要充值）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketClient } from '../../工具/WebSocket客户端.js';
import { bon } from '../../工具/BON协议.js';
import { 成功日志, 错误日志, 警告日志, 信息日志 } from '../../工具/日志工具.js';
import { 更新账号记录 } from '../../工具/执行记录.js';
import { 获取账号配置, 任务是否启用 } from '../../工具/任务配置.js';
import { 更新账号状态 } from '../../工具/账号状态.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取配置
const 主配置 = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/config.json'), 'utf-8'));
const 任务配置 = JSON.parse(fs.readFileSync(path.join(__dirname, './配置.json'), 'utf-8'));

let client = null;
let currentSeq = 1;
const pendingRequests = new Map();

// 默认超时时间
const DEFAULT_TIMEOUT = 15000;

// 响应映射
const responseMap = {
  'BossTower_GetInfoResp': 'bosstower_getinfo',
  'BossTower_StartBossResp': 'bosstower_startboss',
  'BossTower_StartBoxResp': 'bosstower_startbox',
  'BossTower_GetHallResp': 'bosstower_gethall',
  'BossTower_PublishHallResp': 'bosstower_publishhall',
  'BossTower_ClaimRewardResp': 'bosstower_claimreward'
};

// 检查宝库开放时间（周三至周日，周一周二不开放）
function isBossTowerOpen() {
  const day = new Date().getDay();
  return day !== 1 && day !== 2;
}


// 选择第3层奖励（10选6）
function 选择奖励(rewardList, claimedIdxList = []) {
  const 不要的 = [3009];
  const 已领取 = new Set(claimedIdxList);
  const 结果 = [];
  
  const 候选 = rewardList
    .map((item, idx) => ({ ...item, idx }))
    .filter(x => !已领取.has(x.idx));
  
  // 第一轮：必选 itemId=1022，按value从大到小
  const items1022 = 候选.filter(x => x.itemId === 1022).sort((a, b) => b.value - a.value);
  for (const item of items1022) {
    if (结果.length < 6) 结果.push(item.idx);
  }
  
  // 第二轮：必选 itemId=1001，按value从大到小
  const items1001 = 候选.filter(x => x.itemId === 1001).sort((a, b) => b.value - a.value);
  for (const item of items1001) {
    if (结果.length < 6 && !结果.includes(item.idx)) 结果.push(item.idx);
  }
  
  // 第三轮：选 itemId=0 且 value>=588 的（金币大奖）
  const bigCoins = 候选.filter(x => x.itemId === 0 && x.value >= 588).sort((a, b) => b.value - a.value);
  for (const item of bigCoins) {
    if (结果.length < 6 && !结果.includes(item.idx)) 结果.push(item.idx);
  }
  
  // 第四轮：选其他好东西（排除3009、1022、1001、0）
  const 其他好东西 = 候选
    .filter(x => !不要的.includes(x.itemId) && x.itemId !== 1022 && x.itemId !== 1001 && x.itemId !== 0)
    .sort((a, b) => b.value - a.value);
  for (const item of 其他好东西) {
    if (结果.length >= 6) break;
    if (!结果.includes(item.idx)) 结果.push(item.idx);
  }
  
  // 第五轮：选小金币（itemId=0 且 value<588）
  const smallCoins = 候选.filter(x => x.itemId === 0 && x.value < 588).sort((a, b) => b.value - a.value);
  for (const item of smallCoins) {
    if (结果.length < 6 && !结果.includes(item.idx)) 结果.push(item.idx);
  }
  
  // 第六轮：随便选剩下的补齐（排除3009）
  for (const item of 候选) {
    if (结果.length >= 6) break;
    if (!结果.includes(item.idx) && !不要的.includes(item.itemId)) {
      结果.push(item.idx);
    }
  }
  
  return 结果;
}

// 全局消息监听器
function 初始化消息监听器() {
  client.removeAllListeners('message');
  
  client.on('message', (message) => {
    const ack = message.ack;
    const cmd = message.cmd;
    
    // 通过ack匹配
    if (ack && ack > 0 && pendingRequests.has(ack)) {
      const pending = pendingRequests.get(ack);
      clearTimeout(pending.timeoutId);
      pendingRequests.delete(ack);
      pending.resolve(message);
      return;
    }
    
    // 通过cmd匹配（ack=0的情况）
    if (cmd && responseMap[cmd]) {
      const originalCmd = responseMap[cmd];
      for (const [seq, pending] of pendingRequests.entries()) {
        if (pending.cmd === originalCmd) {
          clearTimeout(pending.timeoutId);
          pendingRequests.delete(seq);
          pending.resolve(message);
          return;
        }
      }
    }
  });
}

// 发送游戏指令
async function 发送指令(cmd, body = {}, 超时时间 = DEFAULT_TIMEOUT) {
  const seq = currentSeq++;
  
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      pendingRequests.delete(seq);
      resolve(null);
    }, 超时时间);
    
    pendingRequests.set(seq, { resolve, timeoutId, cmd });
    client.send(cmd, { ...body, seq });
  });
}

function 解析响应(response) {
  if (!response) return null;
  if (response.error) return { error: response.error };
  
  let data = response.body;
  if (data instanceof Uint8Array) {
    data = bon.decode(data);
  }
  return data;
}


// 获取宝库信息
async function 获取宝库信息() {
  const response = await 发送指令('bosstower_getinfo');
  const data = 解析响应(response);
  
  if (data?.bossTower) {
    return data.bossTower;
  }
  return null;
}

// 打BOSS
async function 打BOSS() {
  信息日志('发送命令: bosstower_startboss');
  const response = await 发送指令('bosstower_startboss');
  
  // 检查响应是否为空（超时或未匹配）
  if (!response) {
    警告日志('打BOSS请求超时或无响应');
    return { success: false, error: '请求超时' };
  }
  
  // 检查服务器错误（模块未开启等）
  if (response.error) {
    const errorMsg = typeof response.error === 'string' ? response.error : JSON.stringify(response.error);
    警告日志(`服务器返回错误: ${errorMsg}`);
    if (errorMsg.includes('模块未开启')) {
      return { success: false, error: errorMsg, moduleNotOpen: true };
    }
    return { success: false, error: errorMsg };
  }
  
  const data = 解析响应(response);
  
  // 检查解析后的数据是否有错误
  if (data?.error) {
    const errorMsg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
    警告日志(`数据解析错误: ${errorMsg}`);
    if (errorMsg.includes('模块未开启')) {
      return { success: false, error: errorMsg, moduleNotOpen: true };
    }
    return { success: false, error: errorMsg };
  }
  
  return { success: true, data };
}

// 用钥匙攻击（第3层）
async function 用钥匙攻击() {
  const response = await 发送指令('bosstower_startbox');
  const data = 解析响应(response);
  
  if (data?.error) {
    return { success: false, error: data.error };
  }
  return { success: true, data };
}

// 领取第3层奖励
async function 领取奖励(idx) {
  const response = await 发送指令('bosstower_claimreward', { idx });
  const data = 解析响应(response);
  
  if (data?.error) {
    return { success: false, error: data.error };
  }
  return { success: true, data };
}

// 发布助战请求
async function 发布助战(账号前缀 = '') {
  信息日志(`${账号前缀} 打开助战大厅...`);
  信息日志('发送命令: bosstower_gethall');
  const hallResponse = await 发送指令('bosstower_gethall', {});
  
  // 检查模块未开启
  if (hallResponse?.error) {
    const errorMsg = typeof hallResponse.error === 'string' ? hallResponse.error : JSON.stringify(hallResponse.error);
    if (errorMsg.includes('模块未开启')) {
      警告日志('服务器返回错误：模块未开启');
      return { success: false, moduleNotOpen: true };
    }
  }
  
  await new Promise(r => setTimeout(r, 500));
  
  信息日志(`${账号前缀} 发布助战请求...`);
  信息日志('发送命令: bosstower_publishhall');
  const response = await 发送指令('bosstower_publishhall', { state: true });
  
  // 检查模块未开启
  if (response?.error) {
    const errorMsg = typeof response.error === 'string' ? response.error : JSON.stringify(response.error);
    if (errorMsg.includes('模块未开启')) {
      警告日志('服务器返回错误：模块未开启');
      return { success: false, moduleNotOpen: true };
    }
  }
  
  const data = 解析响应(response);
  
  if (data?.bossTower) {
    成功日志(`${账号前缀} 助战已发布`);
    return { success: true };
  }
  return { success: false };
}

// 等待助战完成（3秒检查一次，最多7次）
async function 等待助战完成(原层数, 账号前缀 = '') {
  信息日志(`${账号前缀} 等待助战完成...`);
  
  for (let i = 1; i <= 7; i++) {
    await new Promise(r => setTimeout(r, 3000));
    
    const info = await 获取宝库信息();
    if (info && info.towerId > 原层数) {
      成功日志(`${账号前缀} 助战成功！已进入第${info.towerId}层`);
      return true;
    }
    信息日志(`${账号前缀} 检查 ${i}/7: 仍在第${info?.towerId || 原层数}层`);
  }
  
  警告日志(`${账号前缀} 助战等待超时，跳过`);
  return false;
}


// 执行BOSS层（第1、2、4、5层）
async function 执行BOSS层(层数, 账号前缀 = '') {
  信息日志(`${账号前缀} === 第${层数}层: 打BOSS ===`);
  
  const 最大次数 = 3;
  
  for (let i = 1; i <= 最大次数; i++) {
    信息日志(`${账号前缀} 第 ${i}/${最大次数} 次打BOSS...`);
    
    const result = await 打BOSS();
    if (!result.success) {
      // 检查是否模块未开启
      if (result.moduleNotOpen) {
        警告日志(`${账号前缀} 宝库模块未开启（需要先完成每日咸王5亿伤害）`);
        return { success: false, moduleNotOpen: true };
      }
      警告日志(`${账号前缀} 战斗失败: ${result.error}`);
      break;
    }
    成功日志(`${账号前缀} 战斗命令已发送`);
    
    await new Promise(r => setTimeout(r, 500));
    
    const info = await 获取宝库信息();
    if (info && info.towerId > 层数) {
      成功日志(`${账号前缀} BOSS击杀成功！已进入第${info.towerId}层`);
      return { success: true, newTowerId: info.towerId };
    }
  }
  
  // 打3次还没过，发布助战
  警告日志(`${账号前缀} 打${最大次数}次未击杀BOSS，发布助战...`);
  const 助战结果 = await 发布助战(账号前缀);
  
  // 检查模块未开启
  if (助战结果.moduleNotOpen) {
    return { success: false, moduleNotOpen: true };
  }
  
  if (助战结果.success) {
    const 等待结果 = await 等待助战完成(层数, 账号前缀);
    if (等待结果) {
      const info = await 获取宝库信息();
      return { success: true, newTowerId: info?.towerId || 层数 + 1 };
    }
  }
  
  return { success: false, newTowerId: 层数 };
}

// 执行第3层（用钥匙）
async function 执行钥匙层(账号前缀 = '') {
  信息日志(`${账号前缀} === 第3层: 用钥匙攻击 ===`);
  
  let info = await 获取宝库信息();
  if (!info) {
    错误日志(`${账号前缀} 获取宝库信息失败`);
    return { success: false };
  }
  
  const boxHp = info.boxCurHp || 0;
  const boxFightCnt = info.boxFightCnt || 0;
  
  信息日志(`${账号前缀} BOSS血量: ${boxHp} / ${info.boxTotalHp || 0}`);
  信息日志(`${账号前缀} 钥匙数量: ${boxFightCnt}`);
  
  // 如果BOSS已死
  if (boxHp <= 0) {
    成功日志(`${账号前缀} BOSS已死亡，进入奖励领取`);
    return { success: true, bossKilled: true };
  }
  
  // 如果没有钥匙
  if (boxFightCnt <= 0) {
    警告日志(`${账号前缀} 没有钥匙了，无法继续`);
    return { success: false, noKeys: true };
  }
  
  // 用钥匙攻击
  const 初始钥匙数 = boxFightCnt;
  for (let i = 1; i <= 初始钥匙数; i++) {
    信息日志(`${账号前缀} 使用钥匙 ${i}/${初始钥匙数}...`);
    
    const result = await 用钥匙攻击();
    if (!result.success) {
      警告日志(`${账号前缀} 攻击失败: ${result.error}`);
      break;
    }
    成功日志(`${账号前缀} 攻击成功`);
    
    await new Promise(r => setTimeout(r, 500));
    
    info = await 获取宝库信息();
    if (info) {
      信息日志(`${账号前缀} BOSS剩余血量: ${info.boxCurHp || 0}, 剩余钥匙: ${info.boxFightCnt || 0}`);
      if ((info.boxCurHp || 0) <= 0) {
        成功日志(`${账号前缀} BOSS已击杀！`);
        return { success: true, bossKilled: true };
      }
      if ((info.boxFightCnt || 0) <= 0) {
        警告日志(`${账号前缀} 钥匙用完`);
        break;
      }
    }
  }
  
  警告日志(`${账号前缀} 钥匙用完，BOSS未击杀`);
  return { success: false, keysUsed: 初始钥匙数 };
}


// 执行第3层奖励领取
async function 执行奖励领取(账号前缀 = '') {
  信息日志(`${账号前缀} === 第3层: 领取奖励 ===`);
  
  const info = await 获取宝库信息();
  if (!info) {
    错误日志(`${账号前缀} 获取宝库信息失败`);
    return false;
  }
  
  const level3Info = info.levelInfoMap?.['3'];
  if (!level3Info) {
    错误日志(`${账号前缀} 没有第3层奖励信息`);
    return false;
  }
  
  const rewardList = level3Info.rewardList || [];
  const claimedIdxList = level3Info.claimedIdxList || [];
  
  信息日志(`${账号前缀} 奖励总数: ${rewardList.length}, 已领取: ${claimedIdxList.length}`);
  
  const 需要领取 = 6 - claimedIdxList.length;
  if (需要领取 <= 0) {
    成功日志(`${账号前缀} 奖励已全部领取`);
    return true;
  }
  
  const 选中索引 = 选择奖励(rewardList, claimedIdxList);
  信息日志(`${账号前缀} 选择领取索引: ${选中索引.join(', ')}`);
  
  let 成功数 = 0;
  for (const idx of 选中索引) {
    const item = rewardList[idx];
    信息日志(`${账号前缀} 领取索引 ${idx} (itemId=${item.itemId}, value=${item.value})...`);
    const result = await 领取奖励(idx);
    if (result.success) {
      成功日志(`${账号前缀} 领取成功`);
      成功数++;
    } else {
      警告日志(`${账号前缀} 领取失败: ${result.error}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }
  
  成功日志(`${账号前缀} 奖励领取完成: ${成功数}/${选中索引.length}`);
  return 成功数 >= 6;
}

// 宝库任务执行器
async function 执行宝库任务(账号前缀 = '') {
  信息日志(`${账号前缀} === 开始执行宝库任务 ===`);
  
  if (!isBossTowerOpen()) {
    警告日志(`${账号前缀} 当前不是宝库开放时间（周一、周二不开放）`);
    return { success: false, reason: '不在开放时间' };
  }
  
  let info = await 获取宝库信息();
  if (!info) {
    错误日志(`${账号前缀} 获取宝库信息失败`);
    return { success: false, reason: '获取信息失败' };
  }
  
  let towerId = info.towerId || 0;
  信息日志(`${账号前缀} 当前层数: ${towerId}`);
  信息日志(`${账号前缀} 钥匙数量: ${info.boxFightCnt || 0}`);
  
  // 已完成
  if (towerId >= 6) {
    成功日志(`${账号前缀} 本周宝库已完成（已通过第5层）`);
    return { success: true, towerId: 6, completed: true };
  }
  
  // 根据层数执行
  while (towerId >= 1 && towerId <= 5) {
    if (towerId === 1 || towerId === 2 || towerId === 4 || towerId === 5) {
      const result = await 执行BOSS层(towerId, 账号前缀);
      // 检查模块未开启
      if (result.moduleNotOpen) {
        警告日志(`${账号前缀} 宝库模块未开启，本周跳过`);
        return { success: true, towerId: 0, reason: '模块未开启', completed: true, moduleNotOpen: true };
      }
      if (!result.success) {
        警告日志(`${账号前缀} 第${towerId}层未通过，等待助战或下次执行`);
        break;
      }
      towerId = result.newTowerId;
    } else if (towerId === 3) {
      const result = await 执行钥匙层(账号前缀);
      if (result.bossKilled) {
        const 领取成功 = await 执行奖励领取(账号前缀);
        if (领取成功) {
          info = await 获取宝库信息();
          const newTowerId = info?.towerId || 0;
          信息日志(`${账号前缀} 当前层数: ${newTowerId}`);
          if (newTowerId > 3) {
            towerId = newTowerId;
          } else {
            警告日志(`${账号前缀} 奖励已领取但层数未变化`);
            break;
          }
        } else {
          警告日志(`${账号前缀} 奖励领取失败`);
          break;
        }
      } else {
        警告日志(`${账号前缀} 第3层钥匙用完或BOSS未击杀，结束任务`);
        break;
      }
    }
  }
  
  // 最终状态
  info = await 获取宝库信息();
  towerId = info?.towerId || 0;
  
  if (towerId >= 6) {
    成功日志(`${账号前缀} 本周宝库已完成！`);
    return { success: true, towerId, completed: true };
  } else {
    信息日志(`${账号前缀} 当前停留在第${towerId}层`);
    return { success: true, towerId, completed: false };
  }
}


// 单个账号执行函数
async function 执行单个账号(tokenData, 账号索引, 总账号数) {
  const 账号前缀 = `[账号${账号索引 + 1}/${总账号数}: ${tokenData.name}]`;
  const 开始时间 = Date.now();
  
  try {
    信息日志(`${账号前缀} 正在连接...`);
    
    client = new WebSocketClient(主配置.wsServer, tokenData.token);
    await client.connect();
    成功日志(`${账号前缀} 连接成功！`);
    
    初始化消息监听器();
    await new Promise(r => setTimeout(r, 1000));
    
    // 获取角色信息
    信息日志(`${账号前缀} 获取角色信息...`);
    const 角色信息响应 = await 发送指令('role_getroleinfo', {
      clientVersion: '1.65.3-wx',
      inviteUid: 0,
      platform: 'hortor',
      platformExt: 'mix',
      scene: ''
    });
    
    if (!角色信息响应) {
      throw new Error('获取角色信息失败');
    }
    成功日志(`${账号前缀} 角色信息获取成功`);
    
    await new Promise(r => setTimeout(r, 500));
    
    // 执行宝库任务
    const result = await 执行宝库任务(账号前缀);
    
    // 更新账号状态
    let 状态备注 = '';
    if (result.moduleNotOpen) {
      状态备注 = '模块未开启';
    } else {
      状态备注 = `第${result.towerId || 0}层`;
    }
    
    更新账号状态(tokenData.name, {
      宝库: {
        状态: result.success ? 'success' : 'failed',
        最后执行时间: new Date().toISOString(),
        当前层数: result.towerId || 0,
        已完成: result.completed || false,
        备注: 状态备注
      }
    });
    
    client.disconnect();
    
    const 执行时长 = Math.round((Date.now() - 开始时间) / 1000);
    成功日志(`${账号前缀} 任务执行完毕 (耗时: ${执行时长}秒)`);
    
    return { 
      success: true, 
      name: tokenData.name,
      towerId: result.towerId,
      completed: result.completed,
      duration: `${执行时长}秒`
    };
  } catch (error) {
    错误日志(`${账号前缀} 执行失败: ${error.message}`);
    
    更新账号状态(tokenData.name, {
      宝库: {
        状态: 'failed',
        最后执行时间: new Date().toISOString(),
        错误: error.message
      }
    });
    
    if (client) {
      try { client.disconnect(); } catch (e) {}
    }
    
    const 执行时长 = Math.round((Date.now() - 开始时间) / 1000);
    return { 
      success: false, 
      name: tokenData.name, 
      error: error.message,
      duration: `${执行时长}秒`
    };
  }
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
    console.error(error);
    process.exit(1);
  }
}


// 单账号模式
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
  
  if (!任务是否启用(账号名称, '宝库')) {
    警告日志(`宝库任务未启用，跳过`);
    process.exit(0);
  }
  
  const result = await 执行单个账号(tokenData, 0, 1);
  
  更新账号记录(result.name, {
    status: result.success ? 'success' : 'failed',
    error: result.error || null,
    towerId: result.towerId || 0,
    duration: result.duration || '0秒'
  });
  
  if (result.success) {
    成功日志('执行完成');
    process.exit(0);
  } else {
    警告日志(`执行失败: ${result.error}`);
    process.exit(0);
  }
}

// 全部账号模式
async function 执行全部账号模式() {
  信息日志('='.repeat(60));
  信息日志('           咸王宝库任务');
  信息日志('='.repeat(60));
  
  const tokensFile = path.join(__dirname, '../../', 主配置.tokensFile);
  const tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf-8'));
  
  if (tokens.length === 0) {
    错误日志('没有可用的Token，请先转换BIN文件');
    process.exit(1);
  }
  
  信息日志(`任务: ${任务配置.任务名称}`);
  信息日志(`频率: ${任务配置.执行频率}`);
  信息日志(`总计 ${tokens.length} 个账号`);
  
  const results = [];
  
  for (let i = 0; i < tokens.length; i++) {
    const tokenData = tokens[i];
    const accountName = tokenData.name;
    
    const 账号配置 = 获取账号配置(accountName);
    if (!账号配置 || !账号配置.启用) {
      警告日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 账号未启用，跳过`);
      results.push({ success: false, name: accountName, error: '账号未启用' });
      continue;
    }
    
    if (!任务是否启用(accountName, '宝库')) {
      警告日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 宝库任务未启用，跳过`);
      results.push({ success: false, name: accountName, error: '宝库任务未启用' });
      continue;
    }
    
    const result = await 执行单个账号(tokenData, i, tokens.length);
    results.push(result);
    
    更新账号记录(result.name, {
      status: result.success ? 'success' : 'failed',
      error: result.error || null,
      towerId: result.towerId || 0,
      duration: result.duration || '0秒'
    });
  }
  
  const 成功 = results.filter(r => r.success).length;
  const 失败 = results.filter(r => !r.success).length;
  const 已完成 = results.filter(r => r.completed).length;
  
  信息日志('');
  信息日志('='.repeat(60));
  成功日志(`所有账号执行完毕！成功: ${成功}, 失败: ${失败}, 本周已完成: ${已完成}`);
  
  if (失败 > 0) {
    错误日志('失败账号:');
    results.filter(r => !r.success).forEach(r => {
      错误日志(`  - ${r.name}: ${r.error}`);
    });
  }
  
  信息日志('='.repeat(60));
}

process.on('SIGINT', () => {
  信息日志('正在退出...');
  if (client) {
    client.disconnect();
  }
  process.exit(0);
});

// 启动
main();
