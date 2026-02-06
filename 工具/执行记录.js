/**
 * 执行记录管理工具
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const recordFile = path.join(__dirname, '../data/execution-record.json');

// 确保data目录存在
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 获取今天的日期字符串
function getTodayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 读取执行记录
export function 读取执行记录() {
  try {
    if (!fs.existsSync(recordFile)) {
      return {
        lastExecutionDate: null,
        executions: {}
      };
    }
    return JSON.parse(fs.readFileSync(recordFile, 'utf-8'));
  } catch (error) {
    console.error('读取执行记录失败:', error.message);
    return {
      lastExecutionDate: null,
      executions: {}
    };
  }
}

// 保存执行记录
export function 保存执行记录(record) {
  try {
    fs.writeFileSync(recordFile, JSON.stringify(record, null, 2), 'utf-8');
  } catch (error) {
    console.error('保存执行记录失败:', error.message);
  }
}

// 检查今天是否已执行（全局检测）
export function 今天已执行() {
  const record = 读取执行记录();
  const today = getTodayString();
  return record.lastExecutionDate === today;
}

// 检查指定账号今天是否已执行
export function 账号今天已执行(accountName) {
  const record = 读取执行记录();
  const today = getTodayString();
  
  // 检查今天的执行记录中是否有该账号且成功
  if (record.executions && record.executions[today]) {
    const accountRecord = record.executions[today].accounts?.[accountName];
    return accountRecord && accountRecord.status === 'success';
  }
  
  return false;
}

// 开始执行记录
export function 开始执行() {
  const record = 读取执行记录();
  const today = getTodayString();
  
  // ✅ 确保 executions 对象存在
  if (!record.executions) {
    record.executions = {};
  }
  
  record.lastExecutionDate = today;
  record.executions[today] = {
    startTime: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    endTime: null,
    totalAccounts: 0,
    successAccounts: 0,
    failedAccounts: 0,
    accounts: {}
  };
  
  保存执行记录(record);
  return record.executions[today];
}

// 完成执行记录
export function 完成执行(totalAccounts, successAccounts, failedAccounts, accountsDetail) {
  try {
    const record = 读取执行记录();
    const today = getTodayString();
    
    // ✅ 确保 executions 对象存在
    if (!record.executions) {
      record.executions = {};
    }
    
    // ✅ 如果今天的执行记录不存在，先创建它
    if (!record.executions[today]) {
      record.executions[today] = {
        startTime: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        endTime: null,
        totalAccounts: 0,
        successAccounts: 0,
        failedAccounts: 0,
        accounts: {}
      };
      record.lastExecutionDate = today;
    }
    
    record.executions[today].endTime = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    record.executions[today].totalAccounts = totalAccounts;
    record.executions[today].successAccounts = successAccounts;
    record.executions[today].failedAccounts = failedAccounts;
    record.executions[today].accounts = accountsDetail;
    
    保存执行记录(record);
  } catch (error) {
    console.error('完成执行记录失败:', error.message);
    // 不抛出错误，避免影响任务执行
  }
}

// 获取最近N天的执行记录
export function 获取最近执行记录(days = 7) {
  const record = 读取执行记录();
  const executions = record.executions || {};
  
  // 获取所有日期并排序
  const dates = Object.keys(executions).sort().reverse();
  
  // 只返回最近N天
  const recentDates = dates.slice(0, days);
  const recentExecutions = {};
  
  recentDates.forEach(date => {
    recentExecutions[date] = executions[date];
  });
  
  return recentExecutions;
}

// 清理超过30天的执行记录
export function 清理过期执行记录() {
  try {
    const record = 读取执行记录();
    const now = new Date();
    const executions = record.executions || {};
    
    Object.keys(executions).forEach(dateStr => {
      const executionDate = new Date(dateStr);
      const daysDiff = (now - executionDate) / (1000 * 60 * 60 * 24);
      
      if (daysDiff > 30) {
        delete executions[dateStr];
        console.log(`已清理过期执行记录: ${dateStr}`);
      }
    });
    
    record.executions = executions;
    保存执行记录(record);
  } catch (error) {
    console.error('清理执行记录失败:', error.message);
  }
}

// 更新单个账号执行记录（实时保存）
export function 更新账号记录(accountName, accountDetail) {
  try {
    const record = 读取执行记录();
    const today = getTodayString();
    
    // ✅ 确保 executions 对象存在
    if (!record.executions) {
      record.executions = {};
    }
    
    // ✅ 如果今天的执行记录不存在，先创建它（单账号模式可能没有调用开始执行）
    if (!record.executions[today]) {
      record.executions[today] = {
        startTime: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        endTime: null,
        totalAccounts: 0,
        successAccounts: 0,
        failedAccounts: 0,
        accounts: {}
      };
      record.lastExecutionDate = today;
    }
    
    // 更新账号记录
    record.executions[today].accounts[accountName] = accountDetail;
    
    // 重新统计成功和失败数
    const accounts = record.executions[today].accounts;
    let successCount = 0;
    let failedCount = 0;
    
    Object.values(accounts).forEach(acc => {
      if (acc.status === 'success') successCount++;
      if (acc.status === 'failed') failedCount++;
    });
    
    record.executions[today].successAccounts = successCount;
    record.executions[today].failedAccounts = failedCount;
    record.executions[today].totalAccounts = Object.keys(accounts).length;
    
    保存执行记录(record);
  } catch (error) {
    console.error('更新账号记录失败:', error.message);
    // 不抛出错误，避免影响任务执行
  }
}
