/**
 * 账号状态管理工具
 * 用于保存和读取每个账号的实时状态信息
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const statusFile = path.join(__dirname, '../data/account-status.json');
const 任务记录文件 = path.join(__dirname, '../data/task-schedule-record.json');

// 确保data目录存在
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

/**
 * 读取所有账号状态
 */
export function 读取账号状态() {
  try {
    if (!fs.existsSync(statusFile)) {
      // 文件不存在，创建空文件
      const emptyData = {};
      fs.writeFileSync(statusFile, JSON.stringify(emptyData, null, 2), 'utf-8');
      return emptyData;
    }
    return JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
  } catch (error) {
    console.error('读取账号状态失败:', error.message);
    return {};
  }
}

/**
 * 保存所有账号状态
 */
export function 保存账号状态(状态数据) {
  try {
    fs.writeFileSync(statusFile, JSON.stringify(状态数据, null, 2), 'utf-8');
  } catch (error) {
    console.error('保存账号状态失败:', error.message);
  }
}

/**
 * 更新单个账号的状态
 * @param {string} accountName - 账号名称
 * @param {object} statusData - 状态数据
 * @param {object} statusData.dailyTask - 每日任务数据
 * @param {number} statusData.dailyTask.dailyPoint - 每日任务进度 (0-100)
 * @param {object} statusData.dailyTask.complete - 任务完成状态
 * @param {object} statusData.bottleHelper - 盐罐机器人数据
 * @param {boolean} statusData.bottleHelper.isRunning - 是否运行中
 * @param {number} statusData.bottleHelper.remainingTime - 剩余时间(秒)
 * @param {object} statusData.hangUp - 挂机数据
 * @param {number} statusData.hangUp.totalTime - 总挂机时间(秒)
 * @param {number} statusData.hangUp.remainingTime - 剩余时间(秒)
 * @param {number} statusData.hangUp.elapsedTime - 已挂机时间(秒)
 * @param {object} statusData.signin - 签到数据
 * @param {boolean} statusData.signin.isSignedIn - 是否已签到
 * @param {object} statusData.study - 答题数据
 * @param {boolean} statusData.study.hasAnswered - 本周是否已答题
 * @param {number} statusData.study.score - 答题分数
 * @param {object} statusData.carKing - 疯狂赛车数据
 * @param {boolean} statusData.carKing.hasPlayed - 本周是否已玩
 * @param {object} statusData.arena - 竞技场数据
 * @param {number} statusData.arena.successCount - 今日成功次数
 * @param {number} statusData.arena.attemptCount - 今日尝试次数
 * @param {string} statusData.arena.status - 执行状态 (success/partial/failed/pending)
 * @param {string} statusData.arena.lastExecuteTime - 最后执行时间
 * @param {number} statusData.lastUpdate - 最后更新时间戳
 */
export function 更新账号状态(accountName, statusData) {
  const allStatus = 读取账号状态();
  
  // 添加更新时间
  statusData.lastUpdate = Date.now();
  
  // 合并更新：保留原有数据，只更新新数据中的字段
  if (allStatus[accountName]) {
    const existing = allStatus[accountName];
    
    // 对每个字段进行智能合并
    Object.keys(statusData).forEach(key => {
      if (key === 'lastUpdate') {
        existing.lastUpdate = statusData.lastUpdate;
      } else if (key === 'carKing') {
        // ✅ 保护carKing字段：只有疯狂赛车任务才能更新carKing
        // 如果statusData中包含carKing，说明是疯狂赛车任务在更新，允许更新
        // 如果statusData中不包含carKing，保留原有数据（不会被其他任务覆盖）
        if (statusData[key] !== undefined) {
          // 深度合并，保留原有字段
          const 新carKing = {
            ...existing[key],
            ...statusData[key]
          };
          
          // ✅ 特殊处理：对于已执行日期数组，进行智能合并
          // 如果新数据中有已执行日期，且不是空数组，使用新数据（因为新数据已经包含了原有日期+今天）
          // 如果新数据中的已执行日期是空数组，但原有数据中有值，保留原有数据
          if (statusData[key].已执行日期 !== undefined) {
            if (Array.isArray(statusData[key].已执行日期)) {
              if (statusData[key].已执行日期.length > 0) {
                // 新数据有值，使用新数据（新数据已经包含了原有日期+今天）
                新carKing.已执行日期 = statusData[key].已执行日期;
              } else {
                // 新数据是空数组，保留原有数据
                if (existing[key]?.已执行日期 && Array.isArray(existing[key].已执行日期) && existing[key].已执行日期.length > 0) {
                  新carKing.已执行日期 = existing[key].已执行日期;
                } else {
                  新carKing.已执行日期 = [];
                }
              }
            }
          } else {
            // 新数据中没有已执行日期字段，保留原有数据
            if (existing[key]?.已执行日期) {
              新carKing.已执行日期 = existing[key].已执行日期;
            }
          }
          
          existing[key] = 新carKing;
        }
      } else if (typeof statusData[key] === 'object' && statusData[key] !== null && !Array.isArray(statusData[key])) {
        // 对象类型：深度合并，保留原有字段
        const 新对象 = {
          ...existing[key],
          ...statusData[key]
        };
        
        // ✅ 特殊处理：对于legionShop字段，如果新数据中的购买日期是null，但原有数据中有值，保留原有数据
        if (key === 'legionShop') {
          if (statusData[key].购买日期 === null && existing[key]?.购买日期) {
            新对象.购买日期 = existing[key].购买日期;
          }
        }
        
        // ✅ 特殊处理：对于blackMarketWeek字段，如果新数据中的购买日期是null，但原有数据中有值，保留原有数据
        if (key === 'blackMarketWeek') {
          if (statusData[key].购买日期 === null && existing[key]?.购买日期) {
            新对象.购买日期 = existing[key].购买日期;
          }
          // 保留重试次数（如果新数据中没有重试次数字段）
          if (statusData[key].重试次数 === undefined && existing[key]?.重试次数 !== undefined) {
            新对象.重试次数 = existing[key].重试次数;
          }
        }
        
        existing[key] = 新对象;
      } else {
        // 基础类型：直接赋值
        existing[key] = statusData[key];
      }
    });
    
    allStatus[accountName] = existing;
  } else {
    // 首次创建，初始化默认结构再合并
    allStatus[accountName] = {
      dailyTask: { dailyPoint: 0, complete: {} },
      bottleHelper: { isRunning: false, remainingTime: 0 },
      hangUp: { totalTime: 0, remainingTime: 0, elapsedTime: 0 },
      signin: { isSignedIn: false },
      study: { hasAnswered: false, score: 0 },
      carKing: { hasPlayed: false },
      arena: { successCount: 0, attemptCount: 0, status: 'pending', lastExecuteTime: null },
      ...statusData
    };
  }
  
  保存账号状态(allStatus);
}

/**
 * 获取单个账号的状态
 */
export function 获取账号状态(accountName) {
  const allStatus = 读取账号状态();
  return allStatus[accountName] || null;
}

/**
 * 初始化账号状态（为新账号创建默认状态）
 * @param {string} accountName - 账号名称
 */
export function 初始化账号状态(accountName) {
  const allStatus = 读取账号状态();
  
  // 如果账号状态已存在，不重复初始化
  if (allStatus[accountName]) {
    return;
  }
  
  // 创建默认状态
  allStatus[accountName] = {
    dailyTask: { dailyPoint: 0, complete: {} },
    bottleHelper: { isRunning: false, remainingTime: 0 },
    hangUp: { totalTime: 0, remainingTime: 0, elapsedTime: 0 },
    signin: { isSignedIn: false },
    study: { hasAnswered: false, score: 0 },
    carKing: { hasPlayed: false },
    arena: { successCount: 0, attemptCount: 0, status: 'pending', lastExecuteTime: null },
    lastUpdate: Date.now()
  };
  
  保存账号状态(allStatus);
}

/**
 * 清理已删除账号的执行记录
 * @param {Set<string>} 有效账号名称 - 有效的账号名称集合
 */
function 清理已删除账号的执行记录(有效账号名称) {
  try {
    if (!fs.existsSync(任务记录文件)) {
      return false;
    }
    
    const 记录 = JSON.parse(fs.readFileSync(任务记录文件, 'utf-8'));
    let 已清理任务数 = 0;
    let 已清理账号数 = 0;
    
    // 遍历所有任务
    Object.keys(记录).forEach(任务名称 => {
      if (!记录[任务名称] || !记录[任务名称].accounts) {
        return;
      }
      
      const 账号记录 = 记录[任务名称].accounts;
      const 账号名称列表 = Object.keys(账号记录);
      let 本次清理数 = 0;
      
      // 清理已删除的账号记录
      账号名称列表.forEach(账号名称 => {
        if (!有效账号名称.has(账号名称)) {
          delete 账号记录[账号名称];
          本次清理数++;
          已清理账号数++;
        }
      });
      
      // 如果该任务下没有账号记录了，清理空对象
      if (Object.keys(账号记录).length === 0) {
        delete 记录[任务名称];
      }
      
      if (本次清理数 > 0) {
        已清理任务数++;
      }
    });
    
    if (已清理账号数 > 0) {
      fs.writeFileSync(任务记录文件, JSON.stringify(记录, null, 2), 'utf-8');
      console.log(`[INFO] 已清理 ${已清理账号数} 个已删除账号的执行记录（涉及 ${已清理任务数} 个任务）`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('清理执行记录失败:', error.message);
    return false;
  }
}

export function 同步账号状态(accountNames) {
  try {
    const allStatus = 读取账号状态();
    const 有效账号名称 = new Set(accountNames);
    const 现有账号名称 = Object.keys(allStatus);
    let hasNewAccount = false;
    let hasDeletedAccount = false;
    
    // 1. 为新账号添加默认状态
    accountNames.forEach(accountName => {
      if (!allStatus[accountName]) {
        初始化账号状态(accountName);
        hasNewAccount = true;
      }
    });
    
    // 2. 清理已删除的账号（不在tokens.json中的账号）
    现有账号名称.forEach(账号名称 => {
      if (!有效账号名称.has(账号名称)) {
        delete allStatus[账号名称];
        hasDeletedAccount = true;
      }
    });
    
    // 3. ✅ 清理已删除账号的执行记录
    if (hasDeletedAccount) {
      清理已删除账号的执行记录(有效账号名称);
    }
    
    // 4. 保存更新后的状态
    if (hasNewAccount || hasDeletedAccount) {
      保存账号状态(allStatus);
      if (hasNewAccount) {
        console.log(`[INFO] 已为新账号初始化状态数据`);
      }
      if (hasDeletedAccount) {
        console.log(`[INFO] 已清理已删除账号的状态数据`);
      }
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('同步账号状态失败:', error.message);
    return false;
  }
}

/**
 * 从角色信息中提取状态数据（增量提取，只提取有数据的字段）
 * @param {object} roleInfo - 角色信息响应
 * @param {string[]} [fields] - 可选：指定要提取的字段列表，如 ['dailyTask', 'hangUp', 'bottleHelper']。如果不指定，则提取所有字段
 * @returns {object} 状态数据
 */
export function 从角色信息提取状态(roleInfo, fields = null) {
  if (!roleInfo || !roleInfo.role) {
    return null;
  }
  
  const role = roleInfo.role;
  const now = Date.now() / 1000;
  
  const 状态数据 = {};
  
  // 如果指定了字段列表，只提取指定的字段
  const 需要提取每日任务 = !fields || fields.includes('dailyTask');
  const 需要提取盐罐 = !fields || fields.includes('bottleHelper');
  const 需要提取挂机 = !fields || fields.includes('hangUp');
  const 需要提取签到 = !fields || fields.includes('signin');
  const 需要提取答题 = !fields || fields.includes('study');
  
  // 每日任务：直接使用服务器返回值
  if (需要提取每日任务 && role.dailyTask) {
    状态数据.dailyTask = {
      dailyPoint: role.dailyTask.dailyPoint || 0,
      complete: role.dailyTask.complete || {}
    };
  }
  
  // 盐罐机器人状态
  if (需要提取盐罐 && role.bottleHelpers) {
    const helperStopTime = role.bottleHelpers.helperStopTime || 0;
    状态数据.bottleHelper = {
      isRunning: helperStopTime > now,
      remainingTime: Math.max(0, Math.floor(helperStopTime - now)),
      helperStopTime: helperStopTime  // 保存绝对时间戳，供前端计算
    };
  }
  
  // 挂机状态
  if (需要提取挂机 && role.hangUp) {
    const lastTime = role.hangUp.lastTime || 0;
    const hangUpTime = role.hangUp.hangUpTime || 0;
    const elapsedTime = now - lastTime;
    
    状态数据.hangUp = {
      totalTime: Math.floor(hangUpTime),
      elapsedTime: Math.floor(elapsedTime),
      remainingTime: Math.max(0, Math.floor(hangUpTime - elapsedTime)),
      lastTime: lastTime,        // 保存开始时间戳
      hangUpTime: hangUpTime     // 保存总时长
    };
  }
  
  // 签到状态（俱乐部签到）
  if (需要提取签到 && role.statisticsTime) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = today.getTime() / 1000;
    
    const signinTime = role.statisticsTime['legion:sign:in'] || 0;
    状态数据.signin = {
      isSignedIn: signinTime > todayTimestamp
    };
  }
  
  // 答题状态（本周是否已答题）
  if (需要提取答题 && role.study) {
    const maxCorrectNum = role.study.maxCorrectNum || 0;
    const beginTime = role.study.beginTime || 0;
    
    // 判断条件：答对题目数>=10 且 答题时间在本周内
    if (maxCorrectNum >= 10 && beginTime > 0) {
      const thisWeek = getThisWeekStart();
      状态数据.study = {
        hasAnswered: beginTime > thisWeek,
        score: maxCorrectNum,
        beginTime: beginTime,
        maxCorrectNum: maxCorrectNum
      };
    } else {
      状态数据.study = {
        hasAnswered: false,
        score: maxCorrectNum,
        beginTime: beginTime,
        maxCorrectNum: maxCorrectNum
      };
    }
  } else if (需要提取答题 && role.statistics) {
    // 备用方案：使用 statistics 字段
    const thisWeek = getThisWeekStart();
    const lastStudyTime = role.statistics['last:study:start:game:time'] || 0;
    const studyScore = role.statistics['study:max:score'] || 0;
    
    状态数据.study = {
      hasAnswered: lastStudyTime > thisWeek,
      score: studyScore
    };
  }
  
  // ✅ 疯狂赛车状态：不提取，由疯狂赛车任务自己管理（避免覆盖详细状态）
  // 原因：疯狂赛车任务会保存详细状态（已发车数量、品阶统计等）
  // 如果这里只提取hasPlayed，会导致详细状态被覆盖
  // if (role.statistics) {
  //   const thisWeek = getThisWeekStart();
  //   const lastCarKingTime = role.statistics['last:legion:carking:time'] || 0;
  //   状态数据.carKing = {
  //     hasPlayed: lastCarKingTime > thisWeek
  //   };
  // }
  
  return 状态数据;
}

/**
 * 获取本周一0点的时间戳
 */
function getThisWeekStart() {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=周日, 1=周一, ...
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // 距离周一的天数
  
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  
  return monday.getTime() / 1000;
}

/**
 * 更新竞技场状态
 * @param {string} accountName - 账号名称
 * @param {object} arenaData - 竞技场数据
 * @param {number} arenaData.successCount - 成功次数
 * @param {number} arenaData.attemptCount - 尝试次数
 * @param {string} arenaData.status - 状态 (success/partial/failed)
 */
export function 更新竞技场状态(accountName, arenaData) {
  const allStatus = 读取账号状态();
  
  // 确保账号状态存在
  if (!allStatus[accountName]) {
    allStatus[accountName] = {
      dailyTask: { dailyPoint: 0, complete: {} },
      bottleHelper: { isRunning: false, remainingTime: 0 },
      hangUp: { totalTime: 0, remainingTime: 0, elapsedTime: 0 },
      signin: { isSignedIn: false },
      study: { hasAnswered: false, score: 0 },
      carKing: { hasPlayed: false },
      arena: { successCount: 0, attemptCount: 0, status: 'pending', lastExecuteTime: null }
    };
  }
  
  // 确保竞技场字段存在
  if (!allStatus[accountName].arena) {
    allStatus[accountName].arena = {
      successCount: 0,
      attemptCount: 0,
      status: 'pending',
      lastExecuteTime: null
    };
  }
  
  // 更新竞技场数据
  allStatus[accountName].arena = {
    successCount: arenaData.successCount || 0,
    attemptCount: arenaData.attemptCount || 0,
    status: arenaData.status || 'pending',
    lastExecuteTime: new Date().toISOString()
  };
  
  // 更新时间戳
  allStatus[accountName].lastUpdate = Date.now();
  
  保存账号状态(allStatus);
}

/**
 * 清理超过7天的状态数据
 */
export function 清理过期状态() {
  try {
    const allStatus = 读取账号状态();
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    
    let cleanedCount = 0;
    Object.keys(allStatus).forEach(accountName => {
      const status = allStatus[accountName];
      if (status.lastUpdate && (now - status.lastUpdate) > sevenDays) {
        delete allStatus[accountName];
        cleanedCount++;
      }
    });
    
    if (cleanedCount > 0) {
      保存账号状态(allStatus);
      console.log(`已清理 ${cleanedCount} 个超过7天未更新的账号状态`);
    }
  } catch (error) {
    console.error('清理过期状态失败:', error.message);
  }
}

/**
 * 更新答题状态（包含失败原因）
 * @param {string} accountName - 账号名称
 * @param {object} studyData - 答题数据
 * @param {boolean} studyData.hasAnswered - 是否已答题
 * @param {number} studyData.score - 答对题目数
 * @param {string} studyData.status - 状态 (completed/failed/timeout/server_closed)
 * @param {string} [studyData.failReason] - 失败原因
 * @param {number} [studyData.beginTime] - 答题开始时间
 * @param {number} [studyData.maxCorrectNum] - 最大答对数
 */
export function 更新答题状态(accountName, studyData) {
  const allStatus = 读取账号状态();
  
  // 确保账号状态存在
  if (!allStatus[accountName]) {
    allStatus[accountName] = {
      dailyTask: { dailyPoint: 0, complete: {} },
      bottleHelper: { isRunning: false, remainingTime: 0 },
      hangUp: { totalTime: 0, remainingTime: 0, elapsedTime: 0 },
      signin: { isSignedIn: false },
      study: { hasAnswered: false, score: 0 },
      carKing: { hasPlayed: false },
      arena: { successCount: 0, attemptCount: 0, status: 'pending', lastExecuteTime: null }
    };
  }
  
  // 确保答题字段存在
  if (!allStatus[accountName].study) {
    allStatus[accountName].study = {
      hasAnswered: false,
      score: 0
    };
  }
  
  // 更新答题数据
  allStatus[accountName].study = {
    hasAnswered: studyData.hasAnswered || false,
    score: studyData.score || 0,
    status: studyData.status || 'unknown',
    failReason: studyData.failReason || null,
    beginTime: studyData.beginTime || 0,
    maxCorrectNum: studyData.maxCorrectNum || 0,
    lastExecuteTime: new Date().toISOString()
  };
  
  // 更新时间戳
  allStatus[accountName].lastUpdate = Date.now();
  
  保存账号状态(allStatus);
}
