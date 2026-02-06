/**
 * 疯狂赛车任务 - 每周一、二、三早上8点执行
 * 执行顺序：
 * 1. 检查是否本周已执行
 * 2. car_claim - 一键收车
 * 3. car_send - 智能发车
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

/**
 * 判断时间戳是否在今天
 */
function 判断是否今天(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  
  // 判断年月日是否相同
  return date.getFullYear() === today.getFullYear() &&
         date.getMonth() === today.getMonth() &&
         date.getDate() === today.getDate();
}

/**
 * 获取今天是周几（0=周日, 1=周一, ..., 6=周六）
 */
function 获取今天周几() {
  return new Date().getDay();
}

/**
 * 检查赛车任务是否已完成（今天已执行）
 * 返回: { 已完成: boolean, 执行日期: string[] } // 如 ['周一', '周二']
 */
function 检查赛车状态(accountStatus) {
  const 结果 = {
    今天已完成: false,
    已执行日期: [],
    本周已完成: false
  };
  
  if (!accountStatus || !accountStatus.carKing) {
    return 结果;
  }
  
  const carKing = accountStatus.carKing;
  
  // 获取已执行的日期列表
  结果.已执行日期 = carKing.已执行日期 || [];
  
  // 检查今天是否已执行
  const 今天 = 获取今天周几();
  const 今天名称 = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][今天];
  
  // ✅ 检查今天是否已完成（周一、二、三）或已检查状态（周四、五、六、日）
  // 如果已执行日期包含今天，且最后更新是今天，则认为今天已完成/已检查
  if (结果.已执行日期.includes(今天名称) && accountStatus.lastUpdate) {
    if (判断是否今天(accountStatus.lastUpdate)) {
      结果.今天已完成 = true;
    }
  }
  
  // 检查是否完成了周一、二、三全部三天
  const 已有周一 = 结果.已执行日期.includes('周一');
  const 已有周二 = 结果.已执行日期.includes('周二');
  const 已有周三 = 结果.已执行日期.includes('周三');
  
  结果.本周已完成 = 已有周一 && 已有周二 && 已有周三;
  
  return 结果;
}

/**
 * 品阶名称映射
 */
const 品阶名称 = {
  1: '绿·普通',
  2: '蓝·稀有',
  3: '紫·史诗',
  4: '橙·传说',
  5: '红·神话',
  6: '金·传奇'
};

/**
 * 获取品阶名称
 */
function 获取品阶名称(color) {
  return 品阶名称[color] || `未知(${color})`;
}

/**
 * 计算奖励中的赛车刷新券数量
 */
function 计算刷新券数量(rewards) {
  if (!rewards || !Array.isArray(rewards)) return 0;
  
  let count = 0;
  for (const reward of rewards) {
    if (reward.type === 3 && reward.itemId === 35002) {
      count += reward.value;
    }
  }
  return count;
}

/**
 * 检测是否包含大奖
 */
function 是否大奖车(rewards) {
  const 大奖列表 = [
    {type: 3, itemId: 3201, value: 10},  // 10个万能碎片
    {type: 3, itemId: 1001, value: 10},  // 10个招募令
    {type: 3, itemId: 1022, value: 2000}, // 2000白玉
    {type: 2, itemId: 0, value: 2000},    // 2000金砖
    {type: 3, itemId: 1023, value: 5},    // 5彩玉
    {type: 3, itemId: 1022, value: 2500}, // 2500白玉
    {type: 3, itemId: 1001, value: 12}    // 12个招募令
  ];
  
  if (!rewards || !Array.isArray(rewards)) return false;
  
  for (const prize of 大奖列表) {
    const found = rewards.find(reward => 
      reward.type === prize.type && 
      reward.itemId === prize.itemId && 
      reward.value >= prize.value
    );
    if (found) return true;
  }
  
  return false;
}

/**
 * 判断车辆是否符合发车条件
 */
function 判断是否发车(carInfo, 刷新券数量) {
  const color = carInfo.color || 0;
  const rewards = carInfo.rewards || [];
  
  // 计算奖励中的赛车刷新券数量
  const 奖励刷新券 = 计算刷新券数量(rewards);
  
  // 如果刷新券充足（>=6），寻找神话以上|赛车刷新券>=4|大奖车
  if (刷新券数量 >= 6) {
    return color >= 5 ||           // 神话以上
           奖励刷新券 >= 4 ||       // 赛车刷新券>=4
           是否大奖车(rewards);     // 大奖车
  } else {
    // 刷新券不足，寻找传说以上|赛车刷新券>=2|大奖车
    return color >= 4 ||           // 传说以上
           奖励刷新券 >= 2 ||       // 赛车刷新券>=2
           是否大奖车(rewards);     // 大奖车
  }
}

/**
 * 获取车辆列表
 */
async function 获取车辆列表(client) {
  const result = await client.发送指令('car_getrolecar', {}, '', 10000);
  
  if (!result || !result.roleCar || !result.roleCar.carDataMap) {
    return [];
  }
  
  const carDataMap = result.roleCar.carDataMap;
  const cars = [];
  
  for (const carId in carDataMap) {
    if (carDataMap.hasOwnProperty(carId)) {
      const carInfo = carDataMap[carId];
      cars.push({
        id: carId,
        slot: carInfo.slot || 0,
        color: carInfo.color || 0,
        sendAt: carInfo.sendAt || 0,
        claimAt: carInfo.claimAt || 0,
        rewards: carInfo.rewards || [],
        refreshCount: carInfo.refreshCount || 0
      });
    }
  }
  
  // 按槽位排序
  return cars.sort((a, b) => a.slot - b.slot);
}

/**
 * 获取刷新券数量
 */
async function 获取刷新券数量(client) {
  const roleInfo = await client.获取角色信息();
  if (roleInfo && roleInfo.role && roleInfo.role.items && roleInfo.role.items[35002]) {
    return roleInfo.role.items[35002].quantity || 0;
  }
  return 0;
}

/**
 * 刷新车辆
 */
async function 刷新车辆(client, carId) {
  await client.发送指令('car_refresh', { carId });
  await new Promise(resolve => setTimeout(resolve, 500));
}

/**
 * 发车
 * @returns {Promise<{success: boolean, alreadyCompleted?: boolean}>} - 如果 alreadyCompleted 为 true，表示今日发车次数已达上限（已执行）
 */
async function 发车(client, carId) {
  try {
    const response = await client.发送指令('car_send', { carId, helperId: 0, text: '' });
    
    // 检查响应中是否包含错误消息
    if (response && response.error) {
      const errText = String(response.error);
      if (errText.includes('发车次数已达上限') || errText.includes('已达上限')) {
        // 今日发车次数已达上限，视为已执行
        return { success: true, alreadyCompleted: true };
      }
      // 其他错误，抛出异常
      throw new Error(errText);
    }
    
    await new Promise(resolve => setTimeout(resolve, 500));
    return { success: true };
  } catch (error) {
    const errText = String(error.message || error);
    // 检查是否是"今日发车次数已达上限"的错误
    if (errText.includes('发车次数已达上限') || errText.includes('已达上限')) {
      // 今日发车次数已达上限，视为已执行
      return { success: true, alreadyCompleted: true };
    }
    // 其他错误，重新抛出
    throw error;
  }
}

/**
 * 一键收车
 */
async function 一键收车(client, accountName) {
  信息日志(`[${accountName}] 执行: 一键收车`);
  
  const cars = await 获取车辆列表(client);
  
  // 筛选可收车的车辆（已发车且有奖励）
  const 可收车列表 = cars.filter(car => 
    car.sendAt > 0 && car.claimAt === 0 && car.rewards.length > 0
  );
  
  if (可收车列表.length > 0) {
    信息日志(`[${accountName}] 找到 ${可收车列表.length} 辆可收车`);
    
    for (const car of 可收车列表) {
      try {
        await client.发送指令('car_claim', { carId: car.id });
        await new Promise(resolve => setTimeout(resolve, 300));
        信息日志(`[${accountName}] 车辆#${car.slot} 收车成功`);
      } catch (error) {
        警告日志(`[${accountName}] 车辆#${car.slot} 收车失败: ${error.message}`);
      }
    }
  } else {
    信息日志(`[${accountName}] 没有可收车的车辆`);
  }
  
  await new Promise(resolve => setTimeout(resolve, 1000));
}

/**
 * 智能发车
 */
async function 智能发车(client, accountName) {
  信息日志(`[${accountName}] 执行: 智能发车`);
  
  // 获取车辆列表和刷新券数量
  let cars = await 获取车辆列表(client);
  let 刷新券 = await 获取刷新券数量(client);
  
  信息日志(`[${accountName}] 当前刷新券数量: ${刷新券}`);
  
  // 筛选未发车的车辆
  const 未发车列表 = cars.filter(car => car.sendAt === 0);
  
  if (未发车列表.length === 0) {
    信息日志(`[${accountName}] 没有未发车的车辆`);
    return;
  }
  
  信息日志(`[${accountName}] 找到 ${未发车列表.length} 辆未发车`);
  
  // 遍历所有未发车的车辆
  for (const car of 未发车列表) {
    信息日志(`[${accountName}] 处理车辆#${car.slot}`);
    信息日志(`[${accountName}] 车辆#${car.slot} 当前品阶: ${获取品阶名称(car.color)}`);
    
    // 判断当前车辆是否符合发车条件
    if (判断是否发车(car, 刷新券)) {
      成功日志(`[${accountName}] 车辆#${car.slot} 已符合发车条件，开始发车`);
      const 发车结果 = await 发车(client, car.id);
      if (发车结果.alreadyCompleted) {
        成功日志(`[${accountName}] 今日发车次数已达上限，任务已完成`);
        return { alreadyCompleted: true };
      }
      continue;
    }
    
    // 持续刷新这辆车直到找到符合条件的车辆或无法继续刷新
    let 应该刷新 = false;
    let 当前车辆 = car;
    
    if (刷新券 >= 6) {
      // 刷新券充足时：使用刷新券寻找神话以上|赛车刷新券>=4|大奖车
      信息日志(`[${accountName}] 车辆#${car.slot} 刷新券充足，使用刷新券刷新该车辆`);
      应该刷新 = true;
    } else {
      // 刷新券不足时
      if (当前车辆.refreshCount === 0) {
        // 有免费刷新：使用免费刷新寻找传说以上|赛车刷新券>=2|大奖车
        信息日志(`[${accountName}] 车辆#${car.slot} 刷新券不足，使用免费刷新寻找传说以上车辆`);
        应该刷新 = true;
      } else {
        // 没有免费刷新且刷新券不足，直接发车
        信息日志(`[${accountName}] 车辆#${car.slot} 没有免费刷新且刷新券不足，直接发车`);
        const 发车结果 = await 发车(client, car.id);
        if (发车结果.alreadyCompleted) {
          成功日志(`[${accountName}] 今日发车次数已达上限，任务已完成`);
          return { alreadyCompleted: true };
        }
        continue;
      }
    }
    
    // 持续刷新
    while (应该刷新) {
      // 执行刷新
      信息日志(`[${accountName}] 车辆#${car.slot} 正在刷新...`);
      await 刷新车辆(client, car.id);
      
      // 重新获取车辆列表
      cars = await 获取车辆列表(client);
      当前车辆 = cars.find(c => c.id === car.id);
      
      if (!当前车辆) {
        警告日志(`[${accountName}] 车辆#${car.slot} 刷新后未找到车辆信息`);
        应该刷新 = false;
        break;
      }
      
      信息日志(`[${accountName}] 车辆#${car.slot} 刷新后品阶: ${获取品阶名称(当前车辆.color)}`);
      
      // 如果使用了刷新券，需要更新刷新券数量
      if (当前车辆.refreshCount > 0) {
        刷新券 = await 获取刷新券数量(client);
        信息日志(`[${accountName}] 消耗1张刷新券，剩余刷新券: ${刷新券}`);
      }
      
      // 再次判断是否符合发车条件
      if (判断是否发车(当前车辆, 刷新券)) {
        成功日志(`[${accountName}] 车辆#${car.slot} 刷新后符合发车条件，开始发车`);
        const 发车结果 = await 发车(client, 当前车辆.id);
        if (发车结果.alreadyCompleted) {
          成功日志(`[${accountName}] 今日发车次数已达上限，任务已完成`);
          return { alreadyCompleted: true };
        }
        应该刷新 = false;
        break;
      } else {
        信息日志(`[${accountName}] 车辆#${car.slot} 刷新后仍不符合发车条件`);
        
        // 检查是否可以继续刷新
        if (刷新券 >= 6) {
          // 刷新券充足，继续使用刷新券
          信息日志(`[${accountName}] 车辆#${car.slot} 继续使用刷新券刷新`);
          应该刷新 = true;
        } else if (当前车辆.refreshCount === 0) {
          // 刷新券不足，但可以继续免费刷新
          信息日志(`[${accountName}] 车辆#${car.slot} 继续免费刷新`);
          应该刷新 = true;
        } else {
          // 没有免费刷新且刷新券不足，直接发车
          信息日志(`[${accountName}] 车辆#${car.slot} 没有免费刷新且刷新券不足，直接发车`);
          const 发车结果 = await 发车(client, 当前车辆.id);
          if (发车结果.alreadyCompleted) {
            成功日志(`[${accountName}] 今日发车次数已达上限，任务已完成`);
            return { alreadyCompleted: true };
          }
          应该刷新 = false;
        }
      }
    }
  }
  
  成功日志(`[${accountName}] 智能发车流程完成`);
  return { success: true };
}

// 执行单个账号的疯狂赛车任务
async function 执行疯狂赛车(client, accountName) {
  信息日志(`[${accountName}] 开始疯狂赛车任务...`);
  
  // 先获取并保存当前状态（无论后续是否执行）
  try {
    信息日志(`[${accountName}] 获取当前车辆状态...`);
    const 当前车辆列表 = await 获取车辆列表(client);
    const 当前刷新券 = await 获取刷新券数量(client);
    
    const 已发车数量 = 当前车辆列表.filter(car => car.sendAt > 0).length;
    const 未发车数量 = 当前车辆列表.filter(car => car.sendAt === 0).length;
    const 可收车数量 = 当前车辆列表.filter(car => car.sendAt > 0 && car.claimAt === 0 && car.rewards.length > 0).length;
    
    const 品阶统计 = {};
    当前车辆列表.forEach(car => {
      const 品阶 = 获取品阶名称(car.color);
      品阶统计[品阶] = (品阶统计[品阶] || 0) + 1;
    });
    
    // 获取已有的执行日期列表（从账号状态读取）
    const statusPath = path.join(__dirname, '../../data/account-status.json');
    let currentAccountStatus = null;
    if (fs.existsSync(statusPath)) {
      const allStatus = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
      currentAccountStatus = allStatus[accountName];
    }
    
    const 原有日期 = currentAccountStatus?.carKing?.已执行日期 || [];
    
    // ✅ 不在这里添加执行日期，只在执行成功后才添加
    // 周一、二、三：执行成功后才添加
    // 周四、五、六、日：状态更新成功后才添加
    
    // ⚠️ 只更新carKing字段，不影响其他字段（如arena）
    const 状态数据 = {
      carKing: {
        hasPlayed: false,  // 不标记为已执行，等待执行成功后再标记
        已发车数量,
        未发车数量,
        可收车数量,
        刷新券数量: 当前刷新券,
        品阶统计,
        总车辆数: 当前车辆列表.length,
        车辆详情: 当前车辆列表.map(car => ({
          槽位: car.slot,
          品阶: 获取品阶名称(car.color),
          已发车: car.sendAt > 0,
          可收车: car.sendAt > 0 && car.claimAt === 0 && car.rewards.length > 0
        })),
        已执行日期: 原有日期  // 不添加执行日期，等待执行成功后再添加
      }
    };
    
    更新账号状态(accountName, 状态数据);
    信息日志(`[${accountName}] 当前状态已保存`);
  } catch (error) {
    警告日志(`[${accountName}] 保存当前状态失败: ${error.message}`);
  }
  
  try {
    // 先检查状态
    信息日志(`[${accountName}] 检查赛车完成状态...`);
    
    // 读取账号状态
    const statusPath = path.join(__dirname, '../../data/account-status.json');
    
    let accountStatus = null;
    if (fs.existsSync(statusPath)) {
      const allStatus = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
      accountStatus = allStatus[accountName];
    }
    
    const 状态检查 = 检查赛车状态(accountStatus);
    const 今天 = 获取今天周几();
    const 今天名称 = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][今天];
    
    // 检查今天是否已完成（周一、二、三）或已检查状态（周四、五、六、日）
    if (状态检查.今天已完成) {
      const lastUpdate = new Date(accountStatus.lastUpdate).toLocaleString();
      if (今天 === 1 || 今天 === 2 || 今天 === 3) {
        成功日志(`[${accountName}] 今天(${今天名称})赛车任务已完成！最后执行时间: ${lastUpdate}`);
      } else {
        成功日志(`[${accountName}] 今天(${今天名称})已检查过状态！最后执行时间: ${lastUpdate}`);
      }
      信息日志(`[${accountName}] 已执行日期: ${状态检查.已执行日期.join(', ')}`);
      信息日志(`[${accountName}] 跳过执行，但仍会保存当前状态`);
      
      // 即使今天已完成，也要获取并保存当前状态（已在开头保存）
      return { success: true, skipped: true, reason: `${今天名称}已完成` };
    }
    
    // ✅ 判断是否需要执行完整任务（收车+发车）还是只检查状态
    const 当前小时 = new Date().getHours();
    const 是发车时间 = (今天 === 1 || 今天 === 2 || 今天 === 3) && 当前小时 >= 8 && 当前小时 < 18;
    
    // 如果不是发车时间
    if (!是发车时间) {
      // ✅ 周一、二、三 非发车时间：不应该被调用（调度器已过滤，但为了安全还是检查）
      if (今天 === 1 || 今天 === 2 || 今天 === 3) {
        警告日志(`[${accountName}] 今天是${今天名称}，非发车时间，不应该被调用`);
        return { success: true, skipped: true, reason: `非发车时间` };
      }
      
      // ✅ 窗口2：周四、五、六、日：检查本周是否已更新过状态
      const 已有周四 = 状态检查.已执行日期.includes('周四');
      const 已有周五 = 状态检查.已执行日期.includes('周五');
      const 已有周六 = 状态检查.已执行日期.includes('周六');
      const 已有周日 = 状态检查.已执行日期.includes('周日');
      const 本周已更新状态 = 已有周四 || 已有周五 || 已有周六 || 已有周日;
      
      if (本周已更新状态) {
        成功日志(`[${accountName}] 本周已更新过状态，跳过`);
        return { success: true, skipped: true, reason: `本周已更新状态` };
      }
      
      // 本周未更新状态，执行状态更新
      信息日志(`[${accountName}] 今天是${今天名称}，执行状态更新（只获取状态，不执行收车发车）`);
      
      try {
        // 只获取车辆列表和刷新券数量
        const 车辆列表 = await 获取车辆列表(client);
        const 刷新券数量 = await 获取刷新券数量(client);
        
        const 已发车数量 = 车辆列表.filter(car => car.sendAt > 0).length;
        const 未发车数量 = 车辆列表.filter(car => car.sendAt === 0).length;
        const 可收车数量 = 车辆列表.filter(car => car.sendAt > 0 && car.claimAt === 0 && car.rewards.length > 0).length;
        
        const 品阶统计 = {};
        车辆列表.forEach(car => {
          const 品阶 = 获取品阶名称(car.color);
          品阶统计[品阶] = (品阶统计[品阶] || 0) + 1;
        });
        
        // 获取已有的执行日期列表
        const 原有日期 = accountStatus?.carKing?.已执行日期 || [];
        
        // ✅ 添加今天到执行日期（防止重复检查状态），去重
        const 新日期列表 = [...new Set([...原有日期, 今天名称])];
        
        // ✅ 更新状态：保存车辆状态，更新执行日期，设置hasPlayed=true（防止重复执行）
        const 状态数据 = {
          carKing: {
            hasPlayed: true,  // ✅ 标记为已执行，防止重复检查状态
            已发车数量,
            未发车数量,
            可收车数量,
            刷新券数量,
            品阶统计,
            总车辆数: 车辆列表.length,
            车辆详情: 车辆列表.map(car => ({
              槽位: car.slot,
              品阶: 获取品阶名称(car.color),
              已发车: car.sendAt > 0,
              可收车: car.sendAt > 0 && car.claimAt === 0 && car.rewards.length > 0
            })),
            已执行日期: 新日期列表  // ✅ 保存执行日期，防止重复检查状态
          }
        };
        
        更新账号状态(accountName, 状态数据);
        成功日志(`[${accountName}] 状态检查完成，已更新到前台WEB`);
        信息日志(`[${accountName}] 车辆状态: 已发车${已发车数量}辆, 未发车${未发车数量}辆, 可收车${可收车数量}辆`);
        信息日志(`[${accountName}] 剩余刷新券: ${刷新券数量}张`);
        信息日志(`[${accountName}] 已执行日期: ${新日期列表.join(', ')}`);
        信息日志(`[${accountName}] 等待下周一执行完整任务`);
        
        return { success: true, skipped: true, reason: `本周未执行，已检查状态(${今天名称})` };
      } catch (error) {
        警告日志(`[${accountName}] 状态检查失败: ${error.message}`);
        // 即使检查失败，也记录执行日期，防止重复执行
        try {
          const 原有日期 = accountStatus?.carKing?.已执行日期 || [];
          const 新日期列表 = [...new Set([...原有日期, 今天名称])];
          const 状态数据 = {
            carKing: {
              hasPlayed: true,
              已执行日期: 新日期列表
            }
          };
          更新账号状态(accountName, 状态数据);
        } catch (updateError) {
          警告日志(`[${accountName}] 更新执行日期失败: ${updateError.message}`);
        }
        return { success: true, skipped: true, reason: `状态检查失败，但已记录执行日期(${今天名称})` };
      }
    }
    
    // 未完成，开始执行
    信息日志(`[${accountName}] 今天(${今天名称})赛车任务未完成，开始执行...`);
    
    // 1. 一键收车
    await 一键收车(client, accountName);
    
    // 2. 智能发车
    const 发车结果 = await 智能发车(client, accountName);
    
    // 如果发车次数已达上限，视为已执行，更新状态并返回成功
    if (发车结果 && 发车结果.alreadyCompleted) {
      成功日志(`[${accountName}] 今日发车次数已达上限，任务已完成`);
      
      // 更新状态为已执行
      try {
        const statusPath = path.join(__dirname, '../../data/account-status.json');
        let currentAccountStatus = null;
        if (fs.existsSync(statusPath)) {
          const allStatus = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
          currentAccountStatus = allStatus[accountName];
        }
        
        const 原有日期 = currentAccountStatus?.carKing?.已执行日期 || [];
        const 今天周几 = 获取今天周几();
        const 今天名称 = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][今天周几];
        
        // 添加今天到执行日期列表（去重）
        const 新日期列表 = [...new Set([...原有日期, 今天名称])];
        
        // 获取最终车辆状态
        const 最终车辆列表 = await 获取车辆列表(client);
        const 刷新券数量 = await 获取刷新券数量(client);
        
        const 已发车数量 = 最终车辆列表.filter(car => car.sendAt > 0).length;
        const 未发车数量 = 最终车辆列表.filter(car => car.sendAt === 0).length;
        const 可收车数量 = 最终车辆列表.filter(car => car.sendAt > 0 && car.claimAt === 0 && car.rewards.length > 0).length;
        
        const 品阶统计 = {};
        最终车辆列表.forEach(car => {
          const 品阶 = 获取品阶名称(car.color);
          品阶统计[品阶] = (品阶统计[品阶] || 0) + 1;
        });
        
        const 状态数据 = {
          carKing: {
            hasPlayed: true,
            已发车数量,
            未发车数量,
            可收车数量,
            刷新券数量,
            品阶统计,
            总车辆数: 最终车辆列表.length,
            车辆详情: 最终车辆列表.map(car => ({
              槽位: car.slot,
              品阶: 获取品阶名称(car.color),
              已发车: car.sendAt > 0,
              可收车: car.sendAt > 0 && car.claimAt === 0 && car.rewards.length > 0
            })),
            已执行日期: 新日期列表
          }
        };
        
        更新账号状态(accountName, 状态数据);
        成功日志(`[${accountName}] 账号状态已更新，今日(${今天名称})已记录`);
        信息日志(`[${accountName}] 已执行日期: ${新日期列表.join(', ')}`);
      } catch (error) {
        警告日志(`[${accountName}] 更新账号状态失败: ${error.message}`);
      }
      
      成功日志(`[${accountName}] 疯狂赛车任务完成（今日发车次数已达上限）`);
      return { success: true, skipped: false, reason: '今日发车次数已达上限' };
    }
    
    // 3. 执行成功，获取最终车辆状态
    const 最终车辆列表 = await 获取车辆列表(client);
    const 刷新券数量 = await 获取刷新券数量(client);
    
    // 统计车辆状态
    const 已发车数量 = 最终车辆列表.filter(car => car.sendAt > 0).length;
    const 未发车数量 = 最终车辆列表.filter(car => car.sendAt === 0).length;
    const 可收车数量 = 最终车辆列表.filter(car => car.sendAt > 0 && car.claimAt === 0 && car.rewards.length > 0).length;
    
    // 统计品阶分布
    const 品阶统计 = {};
    最终车辆列表.forEach(car => {
      const 品阶 = 获取品阶名称(car.color);
      品阶统计[品阶] = (品阶统计[品阶] || 0) + 1;
    });
    
    信息日志(`[${accountName}] 车辆状态: 已发车${已发车数量}辆, 未发车${未发车数量}辆, 可收车${可收车数量}辆`);
    信息日志(`[${accountName}] 剩余刷新券: ${刷新券数量}张`);
    
    // 获取最新角色信息并更新状态（执行成功后添加今天到执行日期）
    try {
      // 读取当前账号状态，获取已有的执行日期
      const statusPath = path.join(__dirname, '../../data/account-status.json');
      let currentAccountStatus = null;
      if (fs.existsSync(statusPath)) {
        const allStatus = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
        currentAccountStatus = allStatus[accountName];
      }
      
      const 原有日期 = currentAccountStatus?.carKing?.已执行日期 || [];
      const 今天周几 = 获取今天周几();
      const 今天名称 = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][今天周几];
      
      // 执行成功，添加今天到执行日期列表（去重）
      const 新日期列表 = [...new Set([...原有日期, 今天名称])];
      
      // ⚠️ 只更新carKing字段，不影响其他字段（如arena）
      const 状态数据 = {
        carKing: {
          hasPlayed: true,
          已发车数量,
          未发车数量,
          可收车数量,
          刷新券数量,
          品阶统计,
          总车辆数: 最终车辆列表.length,
          车辆详情: 最终车辆列表.map(car => ({
            槽位: car.slot,
            品阶: 获取品阶名称(car.color),
            已发车: car.sendAt > 0,
            可收车: car.sendAt > 0 && car.claimAt === 0 && car.rewards.length > 0
          })),
          已执行日期: 新日期列表  // 执行成功后才添加今天到执行日期
        }
      };
      
      更新账号状态(accountName, 状态数据);
      成功日志(`[${accountName}] 账号状态已更新，今日(${今天名称})已记录`);
      信息日志(`[${accountName}] 已执行日期: ${新日期列表.join(', ')}`);
    } catch (error) {
      警告日志(`[${accountName}] 更新账号状态失败: ${error.message}`);
    }
    
    成功日志(`[${accountName}] 疯狂赛车任务完成`);
    return { success: true };
    
  } catch (error) {
    const errText = String(error.message || error);
    
    // 检查是否是"今日发车次数已达上限"的错误，或者是超时错误（可能是因为已达上限导致的）
    const 是已达上限 = errText.includes('发车次数已达上限') || errText.includes('已达上限');
    const 是超时错误 = errText.includes('超时') || errText.includes('timeout');
    
    // 如果是已达上限或超时错误，都视为任务已完成，更新状态
    if (是已达上限 || 是超时错误) {
      if (是已达上限) {
        成功日志(`[${accountName}] 今日发车次数已达上限，任务已完成`);
      } else {
        警告日志(`[${accountName}] 发车请求超时，可能是因为今日已达上限，视为任务已完成`);
      }
      
      // 更新状态为已执行
      try {
        const statusPath = path.join(__dirname, '../../data/account-status.json');
        let currentAccountStatus = null;
        if (fs.existsSync(statusPath)) {
          const allStatus = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
          currentAccountStatus = allStatus[accountName];
        }
        
        const 原有日期 = currentAccountStatus?.carKing?.已执行日期 || [];
        const 今天周几 = 获取今天周几();
        const 今天名称 = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][今天周几];
        
        // 添加今天到执行日期列表（去重）
        const 新日期列表 = [...new Set([...原有日期, 今天名称])];
        
        // 尝试获取最终车辆状态（如果连接仍然有效）
        let 已发车数量 = 0;
        let 未发车数量 = 0;
        let 可收车数量 = 0;
        let 刷新券数量 = 0;
        let 品阶统计 = {};
        let 车辆详情 = [];
        let 总车辆数 = 0;
        
        try {
          const 最终车辆列表 = await 获取车辆列表(client);
          const 刷新券 = await 获取刷新券数量(client);
          
          已发车数量 = 最终车辆列表.filter(car => car.sendAt > 0).length;
          未发车数量 = 最终车辆列表.filter(car => car.sendAt === 0).length;
          可收车数量 = 最终车辆列表.filter(car => car.sendAt > 0 && car.claimAt === 0 && car.rewards.length > 0).length;
          刷新券数量 = 刷新券;
          总车辆数 = 最终车辆列表.length;
          
          最终车辆列表.forEach(car => {
            const 品阶 = 获取品阶名称(car.color);
            品阶统计[品阶] = (品阶统计[品阶] || 0) + 1;
          });
          
          车辆详情 = 最终车辆列表.map(car => ({
            槽位: car.slot,
            品阶: 获取品阶名称(car.color),
            已发车: car.sendAt > 0,
            可收车: car.sendAt > 0 && car.claimAt === 0 && car.rewards.length > 0
          }));
        } catch (fetchError) {
          // 如果获取状态失败，使用之前保存的状态
          警告日志(`[${accountName}] 获取最终状态失败，使用之前保存的状态`);
          // 使用之前保存的状态
          if (currentAccountStatus?.carKing) {
            已发车数量 = currentAccountStatus.carKing.已发车数量 || 0;
            未发车数量 = currentAccountStatus.carKing.未发车数量 || 0;
            可收车数量 = currentAccountStatus.carKing.可收车数量 || 0;
            刷新券数量 = currentAccountStatus.carKing.刷新券数量 || 0;
            品阶统计 = currentAccountStatus.carKing.品阶统计 || {};
            车辆详情 = currentAccountStatus.carKing.车辆详情 || [];
            总车辆数 = currentAccountStatus.carKing.总车辆数 || 0;
          }
        }
        
        const 状态数据 = {
          carKing: {
            hasPlayed: true,
            已发车数量,
            未发车数量,
            可收车数量,
            刷新券数量,
            品阶统计,
            总车辆数,
            车辆详情,
            已执行日期: 新日期列表
          }
        };
        
        更新账号状态(accountName, 状态数据);
        成功日志(`[${accountName}] 账号状态已更新，今日(${今天名称})已记录`);
        信息日志(`[${accountName}] 已执行日期: ${新日期列表.join(', ')}`);
      } catch (updateError) {
        警告日志(`[${accountName}] 更新账号状态失败: ${updateError.message}`);
      }
      
      return { success: true, skipped: false, reason: 是已达上限 ? '今日发车次数已达上限' : '超时（可能已达上限）' };
    }
    
    // 其他错误，返回失败
    错误日志(`[${accountName}] 疯狂赛车任务失败: ${errText}`);
    return { success: false, error: errText };
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
  
  // ✅ 移除日期检查：允许所有日期进入任务执行函数
  // 由 执行疯狂赛车 函数内部判断是执行完整任务（周一、二、三发车时间）还是只检查状态（其他时间）
  
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
  if (!任务是否启用(账号名称, '疯狂赛车')) {
    警告日志(`疯狂赛车任务未启用，跳过`);
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
    const result = await 执行疯狂赛车(client, 账号名称);
    
    // 等待最后一次命令处理完成
    await new Promise(resolve => setTimeout(resolve, 500));
    
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
  // 检查是否是周一、二、三
  const today = new Date().getDay(); // 0=周日, 1=周一, ..., 6=周六
  if (today !== 1 && today !== 2 && today !== 3) {
    信息日志(`今天是周${['日', '一', '二', '三', '四', '五', '六'][today]}，不是执行日，跳过任务`);
    return;
  }
  
  信息日志('============================================================');
  信息日志('       疯狂赛车任务 (每周一、二、三早上9点执行)');
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
    if (!任务是否启用(accountName, '疯狂赛车')) {
      警告日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 疯狂赛车任务未启用，跳过`);
      continue;
    }
    
    信息日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 正在处理...`);
    
    try {
      const client = 创建WebSocket客户端();
      
      // 连接
      await client.连接(tokenInfo.token);
      成功日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 连接成功`);
      
      // 执行任务
      const result = await 执行疯狂赛车(client, accountName);
      
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
  成功日志(`疯狂赛车任务完成！成功: ${successCount}, 失败: ${failedCount}`);
  信息日志('============================================================');
}

// 启动
main();
