/**
 * 每日状态清理工具
 * 负责清理所有需要每日重置的状态
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const statusFile = path.join(__dirname, '../data/account-status.json');
const executionRecordFile = path.join(__dirname, '../data/execution-record.json');
const taskScheduleRecordFile = path.join(__dirname, '../data/task-schedule-record.json');

/**
 * 清除每日账号状态
 */
export function 清除每日账号状态() {
  try {
    if (!fs.existsSync(statusFile)) {
      return 0;
    }
    
    const allStatus = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
    let cleanedCount = 0;
    
    Object.keys(allStatus).forEach(accountName => {
      const status = allStatus[accountName];
      let modified = false;
      
      // 每日任务进度和完成状态
      if (status.dailyTask) {
        status.dailyTask.dailyPoint = 0;
        status.dailyTask.complete = {};
        modified = true;
      }
      
      // 签到状态
      if (status.signin) {
        status.signin.isSignedIn = false;
        modified = true;
      }
      
      // 竞技场每日状态
      if (status.arena) {
        status.arena.successCount = 0;
        status.arena.attemptCount = 0;
        status.arena.status = 'pending';
        status.arena.lastExecuteTime = null;
        modified = true;
      }
      
      // 每日咸王状态
      if (status.每日咸王) {
        status.每日咸王 = {
          状态: 'pending',
          执行次数: 0,
          成功次数: 0,
          最后执行时间: null
        };
        modified = true;
      }
      
      // 灯神任务状态（如果存在）
      if (status.灯神) {
        status.灯神 = {
          状态: 'pending',
          最后执行时间: null,
          执行次数: 0
        };
        modified = true;
      }
      
      // 咸将塔当天统计（每日清理）
      if (status.tower && status.tower.today) {
        status.tower.today = {
          challengeCount: 0,
          successCount: 0,
          failCount: 0,
          date: new Date().toDateString()
        };
        modified = true;
      }
      
      if (modified) {
        cleanedCount++;
      }
    });
    
    if (cleanedCount > 0) {
      fs.writeFileSync(statusFile, JSON.stringify(allStatus, null, 2), 'utf-8');
      console.log(`✅ 已清除 ${cleanedCount} 个账号的每日状态`);
    }
    
    return cleanedCount;
  } catch (error) {
    console.error('❌ 清除每日账号状态失败:', error.message);
    return 0;
  }
}

/**
 * 清除每日执行记录
 */
export function 清除每日执行记录() {
  try {
    if (!fs.existsSync(executionRecordFile)) {
      return;
    }
    
    const record = JSON.parse(fs.readFileSync(executionRecordFile, 'utf-8'));
    
    // 重置最后执行日期，但保留记录结构
    record.lastExecutionDate = null;
    record.executions = {};
    
    fs.writeFileSync(executionRecordFile, JSON.stringify(record, null, 2), 'utf-8');
    console.log('✅ 每日执行记录已清除');
  } catch (error) {
    console.error('❌ 清除每日执行记录失败:', error.message);
  }
}

/**
 * 清除每日任务执行时间记录（task-schedule-record.json）
 * 注意：仅清除每日任务，不清除周期性任务（梦境、答题、赛车等）
 */
export function 清除每日任务执行记录() {
  try {
    if (!fs.existsSync(taskScheduleRecordFile)) {
      return;
    }
    
    const 记录 = JSON.parse(fs.readFileSync(taskScheduleRecordFile, 'utf-8'));
    
    // 需要每日清除的任务列表（只包含每日任务）
    const 每日任务列表 = ['每日任务', '签到', '俱乐部签到', '竞技场', '每日咸王', '灯神', 'BOSS战斗'];
    
    // 只清除每日任务的执行时间记录，保留周期性任务（梦境、答题、赛车等）
    Object.keys(记录).forEach(任务名称 => {
      // 只清除每日任务列表中的任务
      if (每日任务列表.includes(任务名称) && 记录[任务名称].accounts) {
        Object.keys(记录[任务名称].accounts).forEach(账号名称 => {
          // 保留账号结构，但清除执行时间
          delete 记录[任务名称].accounts[账号名称].lastExecutionTime;
          delete 记录[任务名称].accounts[账号名称].lastStatus;
          delete 记录[任务名称].accounts[账号名称].dailyRecord;
        });
      }
    });
    
    fs.writeFileSync(taskScheduleRecordFile, JSON.stringify(记录, null, 2), 'utf-8');
    console.log('✅ 每日任务执行记录已清除（梦境、答题、赛车等周期性任务已保留）');
  } catch (error) {
    console.error('❌ 清除每日任务执行记录失败:', error.message);
  }
}

/**
 * 每日清理主函数
 * 清除所有需要每日重置的状态和记录
 */
export function 执行每日清理() {
  console.log('🗑️ 开始执行每日状态清理...');
  
  const startTime = Date.now();
  
  // 清除每日账号状态
  const accountCount = 清除每日账号状态();
  
  // 清除每日执行记录
  清除每日执行记录();
  
  // 清除每日任务执行记录（task-schedule-record.json）
  清除每日任务执行记录();
  
  const duration = Date.now() - startTime;
  console.log(`✅ 每日状态清理完成，耗时: ${duration}ms`);
  console.log(`📊 清理统计: ${accountCount} 个账号状态已重置`);
}