/**
 * 活动周状态清理工具
 * 负责清理所有需要在新活动周开始时重置的状态
 * 
 * 活动周周期规则：
 * - 每周五 12:00 开始，到下周五 00:00 结束
 * - 循环顺序：黑市周 → 招募周 → 宝箱周 → 黑市周...
 * 
 * 清理时机：
 * - 在新活动周开始时（周五12:00）清理上一个活动周的数据
 * - 只清理当前活动周类型对应的数据，保留其他活动周的数据
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { 获取当前活动周类型, 获取当前活动周开始时间, 获取上一个活动周类型 } from './活动周判断.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const statusFile = path.join(__dirname, '../data/account-status.json');
const taskScheduleRecordFile = path.join(__dirname, '../data/task-schedule-record.json');

/**
 * 清除活动周账号状态
 * @param {string} 活动周类型 - '黑市周' | '招募周' | '宝箱周'
 */
export function 清除活动周账号状态(活动周类型) {
  try {
    if (!fs.existsSync(statusFile)) {
      return 0;
    }
    
    const allStatus = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
    let cleanedCount = 0;
    
    Object.keys(allStatus).forEach(accountName => {
      const status = allStatus[accountName];
      let modified = false;
      
      // ✅ 根据活动周类型清理对应的数据
      if (活动周类型 === '黑市周') {
        // 清理黑市周购买状态
        if (status.blackMarketWeek) {
          status.blackMarketWeek = {
            购买日期: null,
            已购买商品: [],
            重试次数: 0,
            最后重试时间: null,
            更新时间: new Date().toISOString(),
            最后执行结果: null
          };
          modified = true;
        }
      } else if (活动周类型 === '宝箱周') {
        // ✅ 未来：清理宝箱周状态
        if (status.treasureBoxWeek) {
          status.treasureBoxWeek = {
            购买日期: null,
            已购买商品: [],
            更新时间: new Date().toISOString(),
            最后执行结果: null
          };
          modified = true;
        }
      } else if (活动周类型 === '招募周') {
        // ✅ 未来：清理招募周状态
        if (status.recruitWeek) {
          status.recruitWeek = {
            购买日期: null,
            已购买商品: [],
            更新时间: new Date().toISOString(),
            最后执行结果: null
          };
          modified = true;
        }
      }
      
      if (modified) {
        cleanedCount++;
      }
    });
    
    if (cleanedCount > 0) {
      fs.writeFileSync(statusFile, JSON.stringify(allStatus, null, 2), 'utf-8');
      console.log(`✅ 已清除 ${cleanedCount} 个账号的${活动周类型}状态`);
    }
    
    return cleanedCount;
  } catch (error) {
    console.error(`❌ 清除${活动周类型}账号状态失败:`, error.message);
    return 0;
  }
}

/**
 * 清除活动周任务执行记录
 * @param {string} 活动周类型 - '黑市周' | '招募周' | '宝箱周'
 */
export function 清除活动周任务执行记录(活动周类型) {
  try {
    if (!fs.existsSync(taskScheduleRecordFile)) {
      return;
    }
    
    const 记录 = JSON.parse(fs.readFileSync(taskScheduleRecordFile, 'utf-8'));
    
    // ✅ 根据活动周类型确定任务名称
    const 任务名称映射 = {
      '黑市周': '黑市周购买',
      '宝箱周': '宝箱周购买', // 未来
      '招募周': '招募周购买'  // 未来
    };
    
    const 任务名称 = 任务名称映射[活动周类型];
    if (!任务名称) {
      console.warn(`⚠️  未知的活动周类型: ${活动周类型}`);
      return;
    }
    
    // 清除对应任务的执行记录
    if (记录[任务名称] && 记录[任务名称].accounts) {
      Object.keys(记录[任务名称].accounts).forEach(账号名称 => {
        // 保留账号结构，但清除执行时间
        delete 记录[任务名称].accounts[账号名称].lastExecutionTime;
        delete 记录[任务名称].accounts[账号名称].lastStatus;
        // 保留dailyRecord（如果有），因为活动周内可能有多次执行
      });
      
      fs.writeFileSync(taskScheduleRecordFile, JSON.stringify(记录, null, 2), 'utf-8');
      console.log(`✅ ${任务名称}执行记录已清除`);
    }
  } catch (error) {
    console.error(`❌ 清除${活动周类型}任务执行记录失败:`, error.message);
  }
}

/**
 * 检查是否需要执行活动周清理
 * @returns {object} { needCleanup: boolean, currentWeekType: string, previousWeekType: string }
 */
export function 检查活动周清理() {
  try {
    const 清理记录文件 = path.join(__dirname, '../data/cleanup-record.json');
    let 清理记录 = {};
    
    if (fs.existsSync(清理记录文件)) {
      清理记录 = JSON.parse(fs.readFileSync(清理记录文件, 'utf-8'));
    }
    
    const now = new Date();
    const 当前活动周类型 = 获取当前活动周类型(now);
    const 当前活动周开始时间 = 获取当前活动周开始时间(now);
    const 当前活动周开始时间戳 = 当前活动周开始时间.getTime();
    
    // 检查上次清理的活动周类型和时间
    const 上次清理活动周类型 = 清理记录.lastActivityWeekType;
    const 上次清理活动周开始时间 = 清理记录.lastActivityWeekStartTime;
    
    // 如果活动周类型变化了，或者这是第一次清理，需要清理
    const 活动周类型变化 = 上次清理活动周类型 !== 当前活动周类型;
    const 活动周开始时间变化 = 上次清理活动周开始时间 !== 当前活动周开始时间戳;
    
    if (活动周类型变化 || 活动周开始时间变化) {
      // 需要清理上一个活动周的数据
      const 上一个活动周类型 = 上次清理活动周类型 || 获取上一个活动周类型(now);
      
      return {
        needCleanup: true,
        currentWeekType: 当前活动周类型,
        previousWeekType: 上一个活动周类型,
        currentWeekStartTime: 当前活动周开始时间戳
      };
    }
    
    return {
      needCleanup: false,
      currentWeekType: 当前活动周类型,
      previousWeekType: 上次清理活动周类型,
      currentWeekStartTime: 当前活动周开始时间戳
    };
  } catch (error) {
    console.error('❌ 检查活动周清理失败:', error.message);
    return {
      needCleanup: false,
      currentWeekType: null,
      previousWeekType: null,
      currentWeekStartTime: null
    };
  }
}

/**
 * 保存活动周清理记录
 */
function 保存活动周清理记录(活动周类型, 活动周开始时间) {
  try {
    const 清理记录文件 = path.join(__dirname, '../data/cleanup-record.json');
    let 清理记录 = {};
    
    if (fs.existsSync(清理记录文件)) {
      清理记录 = JSON.parse(fs.readFileSync(清理记录文件, 'utf-8'));
    }
    
    清理记录.lastActivityWeekType = 活动周类型;
    清理记录.lastActivityWeekStartTime = 活动周开始时间;
    清理记录.lastActivityWeekCleanupTime = new Date().toISOString();
    
    fs.writeFileSync(清理记录文件, JSON.stringify(清理记录, null, 2), 'utf-8');
  } catch (error) {
    console.error('❌ 保存活动周清理记录失败:', error.message);
  }
}

/**
 * 活动周清理主函数
 * 在新活动周开始时，清理上一个活动周的数据
 */
export function 执行活动周清理() {
  console.log('🗑️ 开始执行活动周状态清理...');
  
  const startTime = Date.now();
  
  // 检查是否需要清理
  const 清理检查 = 检查活动周清理();
  
  if (!清理检查.needCleanup) {
    console.log(`ℹ️  当前活动周: ${清理检查.currentWeekType}，无需清理`);
    return 0;
  }
  
  console.log(`📅 活动周变化: ${清理检查.previousWeekType} → ${清理检查.currentWeekType}`);
  console.log(`🧹 清理上一个活动周(${清理检查.previousWeekType})的数据...`);
  
  // 清理上一个活动周的数据
  const accountCount = 清除活动周账号状态(清理检查.previousWeekType);
  清除活动周任务执行记录(清理检查.previousWeekType);
  
  // 保存清理记录
  保存活动周清理记录(清理检查.currentWeekType, 清理检查.currentWeekStartTime);
  
  const duration = Date.now() - startTime;
  console.log(`✅ 活动周状态清理完成，耗时: ${duration}ms`);
  console.log(`📊 清理统计: ${accountCount} 个账号的${清理检查.previousWeekType}状态已重置`);
  console.log(`📅 当前活动周: ${清理检查.currentWeekType}`);
  
  return accountCount;
}



