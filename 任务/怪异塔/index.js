/**
 * 怪异塔任务 - 主程序
 * 执行频率: 当能量充足时执行
 * 
 * 任务说明:
 * 怪异塔是一个爬塔挑战功能，消耗小鱼干能量不断挑战关卡
 * 支持连续失败保护、连接状态检测和重连、章节奖励领取
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { 创建WebSocket客户端 } from '../../工具/WebSocket客户端.js';
import { 成功日志, 错误日志, 警告日志, 信息日志 } from '../../工具/日志工具.js';
import { 更新账号记录 } from '../../工具/执行记录.js';
import { 获取账号配置, 任务是否启用 } from '../../工具/任务配置.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取配置
const 主配置 = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/config.json'), 'utf-8'));
const 任务配置 = JSON.parse(fs.readFileSync(path.join(__dirname, './配置.json'), 'utf-8'));

// 活动状态文件（全局共享，一个账号检测后其他账号复用结果）
const 活动状态文件 = path.join(__dirname, '../../data/evotower-status.json');

// 获取今天日期字符串
function 获取今天日期() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

// 读取活动状态
function 读取活动状态() {
  try {
    if (fs.existsSync(活动状态文件)) {
      return JSON.parse(fs.readFileSync(活动状态文件, 'utf-8'));
    }
  } catch (e) {}
  return { date: null, isOpen: null, checkTime: null };
}

// 保存活动状态
function 保存活动状态(isOpen) {
  const now = new Date();
  const 状态 = { 
    date: 获取今天日期(), 
    isOpen,
    checkTime: now.toISOString()
  };
  fs.writeFileSync(活动状态文件, JSON.stringify(状态, null, 2), 'utf-8');
}

// 判断是否需要检测活动状态
function 需要检测活动() {
  const now = new Date();
  const 当前小时 = now.getHours();
  const 状态 = 读取活动状态();
  const 今天 = 获取今天日期();
  
  // 每天13点后检测一次（活动通常12点开放）
  if (当前小时 >= 13 && 状态.date !== 今天) {
    return true;
  }
  
  return false;
}

// 检查是否应该跳过执行（活动未开放且今天已检测过）
function 应该跳过执行() {
  const 状态 = 读取活动状态();
  const 今天 = 获取今天日期();
  
  // 活动已开放，不跳过
  if (状态.isOpen === true && 状态.date === 今天) {
    return false;
  }
  
  // 今天已检测为未开放，跳过
  if (状态.isOpen === false && 状态.date === 今天) {
    return true;
  }
  
  // 需要检测（今天还没检测），不跳过
  return false;
}

// 层数格式转换
function 格式化层数(towerId) {
  if (towerId === 0) return '1-1';
  const chapter = Math.floor(towerId / 10) + 1;
  const floor = (towerId % 10) + 1;
  return `${chapter}-${floor}`;
}

// 执行怪异塔爬塔
async function 执行怪异塔(client, tokenData, 设置, 账号前缀 = '') {
  const prefix = 账号前缀 ? `${账号前缀} ` : '';
  let 胜利次数 = 0;
  let 失败次数 = 0;
  let 连续失败次数 = 0;
  const 连续失败阈值 = 设置.连续失败阈值 || 3;

  try {
    信息日志(`${prefix}━━━━━ 开始怪异塔挑战 ━━━━━`);

    // 1. 获取怪异塔信息（同时检测活动是否开放）
    信息日志(`${prefix}获取怪异塔信息...`);
    const towerInfoResp = await client.发送指令('evotower_getinfo', {}, '获取怪异塔信息', 15000);

    if (!towerInfoResp) {
      警告日志(`${prefix}未获取到怪异塔信息（响应为空）`);
      return { 胜利次数: 0, 失败次数: 0, 活动未开放: true };
    }

    // 检测活动是否开放（code: 2100010 表示活动未开放）
    if (towerInfoResp.error || towerInfoResp.code === 2100010) {
      警告日志(`${prefix}怪异塔活动未开放`);
      return { 胜利次数: 0, 失败次数: 0, 活动未开放: true };
    }

    // 解析响应数据（兼容多种格式）
    let towerData = null;

    // 情况1: 响应直接就是 evoTower 数据
    if (towerInfoResp.evoTower) {
      towerData = towerInfoResp;
    }
    // 情况2: 响应有 body 字段
    else if (towerInfoResp.body) {
      towerData = towerInfoResp.body;
      // 如果 body 是 Uint8Array，需要解码
      if (towerData instanceof Uint8Array) {
        const { bon } = await import('../../工具/BON协议.js');
        towerData = bon.decode(towerData);
      }
    }
    // 情况3: 响应本身可能需要解码
    else if (towerInfoResp instanceof Uint8Array) {
      const { bon } = await import('../../工具/BON协议.js');
      towerData = bon.decode(towerInfoResp);
    }
    else {
      错误日志(`${prefix}怪异塔响应格式未知`);
      return { 胜利次数: 0, 失败次数: 0, 能量不足: true };
    }

    if (!towerData || !towerData.evoTower) {
      错误日志(`${prefix}怪异塔数据格式错误`);
      return { 胜利次数: 0, 失败次数: 0, 能量不足: true };
    }

    let energy = towerData.evoTower.energy || 0;
    let towerId = towerData.evoTower.towerId || 0;

    if (energy <= 0) {
      警告日志(`${prefix}⚠️  小鱼干能量不足 (${energy})`);
      return { 胜利次数: 0, 失败次数: 0, 能量不足: true };
    }

    信息日志(`${prefix}当前层数: ${格式化层数(towerId)} (${towerId})`);
    信息日志(`${prefix}剩余能量: ${energy}`);
    信息日志('');

    // 2. 爬塔循环（参考咸将塔的双层循环模式）
    let 挑战次数 = 0;
    const 最大总挑战次数 = 500; // 安全上限，防止死循环

    while (挑战次数 < 最大总挑战次数) {
      // ===== 外层循环：检查能量，确定本轮循环次数 =====
      信息日志(`${prefix}========== 新一轮循环（检查能量）==========`);
      
      // 获取最新能量
      const energyCheckResp = await client.发送指令('evotower_getinfo', {}, '检查能量', 10000);
      if (energyCheckResp?.error || energyCheckResp?.code === 2100010) {
        警告日志(`${prefix}活动已关闭，停止挑战`);
        break;
      }
      
      let checkData = energyCheckResp?.body || energyCheckResp;
      if (checkData instanceof Uint8Array) {
        const { bon } = await import('../../工具/BON协议.js');
        checkData = bon.decode(checkData);
      }
      
      if (checkData?.evoTower) {
        energy = checkData.evoTower.energy ?? 0;
        towerId = checkData.evoTower.towerId ?? towerId;
      }
      
      if (energy <= 0) {
        信息日志(`${prefix}能量已用完（${energy}），停止挑战`);
        break;
      }
      
      const 本轮循环次数 = energy;
      信息日志(`${prefix}当前能量: ${energy}，本轮可挑战 ${本轮循环次数} 次`);
      
      // ===== 内层循环：根据能量数循环挑战 =====
      for (let i = 0; i < 本轮循环次数 && 挑战次数 < 最大总挑战次数; i++) {
        挑战次数++;
        信息日志(`${prefix}[挑战 ${挑战次数}] 当前层数: ${格式化层数(towerId)}, 能量: ${energy}`);

        try {
          // 准备战斗
          await client.发送指令('evotower_readyfight', {}, '准备战斗', 10000);
          await new Promise(resolve => setTimeout(resolve, 200));

          // 开始战斗
          const fightResp = await client.发送指令('evotower_fight', {
            battleNum: 1,
            winNum: 1
          }, '执行战斗', 15000);

          if (!fightResp) {
            throw new Error('战斗响应为空');
          }

          // 重置连续失败次数
          连续失败次数 = 0;

          // 解析战斗结果
          let fightData = fightResp.body || fightResp;
          if (fightData instanceof Uint8Array) {
            const { bon } = await import('../../工具/BON协议.js');
            fightData = bon.decode(fightData);
          }

          const evoTowerData = fightData.evoTower;
          const winListData = fightData.winList;

          // 更新能量（从战斗响应中获取）
          let newEnergy = evoTowerData?.energy;
          if (newEnergy === undefined || newEnergy === null) {
            newEnergy = Math.max(0, energy - 1);
          }
          energy = newEnergy;

          // 判断胜负
          let isWin = false;
          if (Array.isArray(winListData) && winListData.length > 0) {
            isWin = winListData[0] === true;
          } else if (evoTowerData) {
            // 如果有evoTower数据返回，默认认为胜利
            isWin = true;
          }

          if (isWin) {
            胜利次数++;
            成功日志(`${prefix}✅ 第${挑战次数}次挑战胜利！`);

            // 获取最新塔信息（与原版一致）
            const latestInfo = await client.发送指令('evotower_getinfo', {}, '获取最新塔信息', 10000);
            const latestBody = latestInfo?.body || latestInfo;
            let latestEvoTower = latestBody?.evoTower || latestBody;
            
            // 解码（如果需要）
            if (latestBody instanceof Uint8Array) {
              const { bon } = await import('../../工具/BON协议.js');
              const decoded = bon.decode(latestBody);
              latestEvoTower = decoded?.evoTower;
            }

            if (latestEvoTower) {
              const newTowerId = latestEvoTower.towerId || 0;
              energy = latestEvoTower.energy || energy;

              // 通关检测：层数个位变为1，表示进入新章节
              if (newTowerId > towerId) {
                const newFloor = (newTowerId % 10) + 1;
                if (newFloor === 1) {
                  const chapter = Math.floor(towerId / 10) + 1;
                  信息日志(`${prefix}🎉 恭喜通关第 ${chapter} 章！正在领取奖励...`);
                  try {
                    await client.发送指令('evotower_claimreward', {}, '领取章节奖励', 10000);
                    成功日志(`${prefix}成功领取第 ${chapter} 章通关奖励`);

                    // 领取奖励后重新获取能量（可能增加）
                    const rewardInfo = await client.发送指令('evotower_getinfo', {}, '获取奖励后信息', 10000);
                    let rewardBody = rewardInfo?.body || rewardInfo;
                    if (rewardBody instanceof Uint8Array) {
                      const { bon } = await import('../../工具/BON协议.js');
                      rewardBody = bon.decode(rewardBody);
                    }
                    const rewardEvoTower = rewardBody?.evoTower;
                    if (rewardEvoTower) {
                      energy = rewardEvoTower.energy || energy;
                      信息日志(`${prefix}领取奖励后能量: ${energy}`);
                    }
                  } catch (rewardError) {
                    警告日志(`${prefix}领取奖励失败: ${rewardError.message}`);
                  }
                }
              }

              towerId = newTowerId;
              信息日志(`${prefix}当前层数: ${格式化层数(towerId)}`);
            }
          } else {
            失败次数++;
            警告日志(`${prefix}❌ 第${挑战次数}次挑战失败`);
          }

          // 等待后继续下一次
          await new Promise(resolve => setTimeout(resolve, 设置.挑战间隔 || 400));

        } catch (error) {
          错误日志(`${prefix}挑战失败: ${error.message}`);
          失败次数++;
          连续失败次数++;

          if (连续失败次数 >= 连续失败阈值) {
            警告日志(`${prefix}⚠️  连续失败${连续失败次数}次，停止挑战`);
            break;
          }

          // 失败后等待
          await new Promise(resolve => setTimeout(resolve, 设置.失败后等待 || 2000));
        }
      } // 内层 for 循环结束
      
      // 内层循环结束后，继续外层循环检查能量
      await new Promise(resolve => setTimeout(resolve, 500));
    } // 外层 while 循环结束

    // 3. 尝试领取任务奖励
    信息日志(`${prefix}尝试领取怪异塔任务奖励...`);
    for (let taskId = 1; taskId <= 3; taskId++) {
      try {
        await client.发送指令('evotower_claimtask', { taskId }, `领取任务奖励${taskId}`, 8000);
        成功日志(`${prefix}领取任务奖励 taskId=${taskId} 成功`);
      } catch (taskError) {
        // 静默处理，可能是任务未完成
      }
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // 输出统计
    信息日志('');
    信息日志(`${prefix}━━━━━ 挑战统计 ━━━━━`);
    信息日志(`${prefix}总挑战次数: ${挑战次数}`);
    信息日志(`${prefix}胜利: ${胜利次数} 次`);
    信息日志(`${prefix}失败: ${失败次数} 次`);
    信息日志(`${prefix}最终层数: ${格式化层数(towerId)}`);
    信息日志(`${prefix}剩余能量: ${energy}`);
    信息日志(`${prefix}━━━━━━━━━━━━━━━`);

    return { 胜利次数, 失败次数, 能量不足: energy <= 0 };

  } catch (error) {
    错误日志(`${prefix}怪异塔挑战失败: ${error.message}`);
    return { 胜利次数, 失败次数, 发生错误: true };
  }
}


// 单个账号执行函数
async function 执行单个账号(tokenData, 账号索引, 总账号数) {
  const 账号前缀 = `[账号${账号索引 + 1}/${总账号数}: ${tokenData.name}]`;
  const 开始时间 = Date.now();
  let client = null;

  // ✅ 先检查是否应该跳过（活动未开放且不需要检测）
  if (应该跳过执行()) {
    信息日志(`${账号前缀} 怪异塔活动未开放，跳过`);
    return {
      success: true,
      name: tokenData.name,
      notOpen: true,
      skipped: true,
      duration: '0秒'
    };
  }

  try {
    信息日志(`${账号前缀} 正在连接...`);

    client = 创建WebSocket客户端();
    await client.连接(tokenData.token);
    成功日志(`${账号前缀} 连接成功！`);

    // 等待连接稳定
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 获取账号配置
    const 账号配置 = 获取账号配置(tokenData.name, '怪异塔');
    const 设置 = 账号配置 || 任务配置.设置;

    // 执行怪异塔
    const 结果 = await 执行怪异塔(client, tokenData, 设置, 账号前缀);

    // 关闭连接
    client.断开连接();

    const 执行时长 = Math.round((Date.now() - 开始时间) / 1000);

    // ✅ 如果活动未开放，保存状态供其他账号复用
    if (结果.活动未开放) {
      保存活动状态(false);
      警告日志(`${账号前缀} ⚠️  怪异塔活动未开放（已记录，后续账号将跳过）`);
      return {
        success: true,
        name: tokenData.name,
        notOpen: true,
        duration: `${执行时长}秒`
      };
    }
    
    // ✅ 活动开放，也保存状态
    if (!结果.活动未开放 && !结果.发生错误) {
      保存活动状态(true);
    }
    
    if (结果.能量不足) {
      警告日志(`${账号前缀} ⚠️  能量不足，无法挑战 (耗时: ${执行时长}秒)`);
      return {
        success: false,  // 改为false，让调度器知道任务未完成
        name: tokenData.name,
        winCount: 结果.胜利次数,
        loseCount: 结果.失败次数,
        noEnergy: true,
        duration: `${执行时长}秒`
      };
    } else if (结果.发生错误) {
      错误日志(`${账号前缀} ❌ 任务失败 (耗时: ${执行时长}秒)`);
      return {
        success: false,
        name: tokenData.name,
        error: '执行过程中发生错误',
        duration: `${执行时长}秒`
      };
    } else {
      成功日志(`${账号前缀} ✅ 任务完成 (耗时: ${执行时长}秒)`);
      return {
        success: true,
        name: tokenData.name,
        winCount: 结果.胜利次数,
        loseCount: 结果.失败次数,
        duration: `${执行时长}秒`
      };
    }

  } catch (error) {
    错误日志(`${账号前缀} 执行失败: ${error.message}`);
    if (client) {
      client.断开连接();
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

  if (!任务是否启用(账号名称, '怪异塔')) {
    警告日志(`怪异塔任务未启用，跳过`);
    process.exit(0);
  }

  const result = await 执行单个账号(tokenData, 0, 1);

  更新账号记录(result.name, {
    status: result.success ? 'success' : 'failed',
    error: result.error || null,
    winCount: result.winCount || 0,
    loseCount: result.loseCount || 0,
    duration: result.duration || '0秒'
  });

  if (result.success) {
    成功日志('执行完成');
    process.exit(0);
  } else if (result.noEnergy) {
    // 能量不足，返回退出码2，调度器不记录执行时间（下次能量恢复可以再执行）
    警告日志('能量不足，等待下次执行');
    process.exit(2);
  } else if (result.notOpen) {
    // 活动未开放，返回退出码0，调度器记录执行时间
    成功日志('活动未开放，已跳过');
    process.exit(0);
  } else {
    错误日志(`执行失败: ${result.error}`);
    // 失败返回退出码1
    process.exit(1);
  }
}

// 全部账号模式
async function 执行全部账号模式(强制执行) {
  try {
    信息日志('='.repeat(60));
    信息日志('           怪异塔挑战任务');
    if (强制执行) {
      警告日志('           （强制执行模式）');
    }
    信息日志('='.repeat(60));
    信息日志('');

    const tokensFile = path.join(__dirname, '../../', 主配置.tokensFile);
    const tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf-8'));

    if (tokens.length === 0) {
      错误日志('没有可用的Token，请先转换BIN文件');
      process.exit(1);
    }

    信息日志(`任务: ${任务配置.任务名称}`);
    信息日志(`总计 ${tokens.length} 个账号`);
    信息日志('');

    const results = [];
    let 总胜利次数 = 0;
    let 总失败次数 = 0;

    for (let i = 0; i < tokens.length; i++) {
      const tokenData = tokens[i];
      const accountName = tokenData.name;

      const 账号配置 = 获取账号配置(accountName);
      if (!账号配置 || !账号配置.启用) {
        警告日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 账号未启用，跳过`);
        results.push({ success: false, name: accountName, error: '账号未启用' });
        continue;
      }

      if (!任务是否启用(accountName, '怪异塔')) {
        警告日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 怪异塔任务未启用，跳过`);
        results.push({ success: false, name: accountName, error: '怪异塔任务未启用' });
        continue;
      }

      const result = await 执行单个账号(tokenData, i, tokens.length);
      results.push(result);

      if (result.winCount) 总胜利次数 += result.winCount;
      if (result.loseCount) 总失败次数 += result.loseCount;

      更新账号记录(result.name, {
        status: result.success ? 'success' : 'failed',
        error: result.error || null,
        winCount: result.winCount || 0,
        loseCount: result.loseCount || 0,
        duration: result.duration || '0秒'
      });

      // 账号间隔5秒
      if (i < tokens.length - 1) {
        信息日志('等待5秒后执行下一个账号...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    const 成功数 = results.filter(r => r.success).length;
    const 失败数 = results.filter(r => !r.success).length;

    信息日志('');
    信息日志('='.repeat(60));
    信息日志('执行统计:');
    信息日志(`  总账号数: ${tokens.length}`);
    信息日志(`  成功: ${成功数}`);
    信息日志(`  失败: ${失败数}`);
    信息日志(`  总胜利次数: ${总胜利次数}`);
    信息日志(`  总失败次数: ${总失败次数}`);
    信息日志('='.repeat(60));

    if (失败数 > 0) {
      信息日志('');
      信息日志('失败账号:');
      results.filter(r => !r.success).forEach(r => {
        信息日志(`  - ${r.name}: ${r.error}`);
      });
    }

    成功日志('怪异塔任务全部完成');
    process.exit(0);

  } catch (error) {
    错误日志('执行失败:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// 运行主函数
main();
