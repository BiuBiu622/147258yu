/**
 * 清理每日任务状态
 * 只清理每日任务相关的执行记录，其他任务不受影响
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 文件路径
const executionRecordFile = path.join(__dirname, '../data/execution-record.json');
const taskScheduleRecordFile = path.join(__dirname, '../data/task-schedule-record.json');

console.log('');
console.log('========================================');
console.log('       清理每日任务执行状态');
console.log('========================================');
console.log('');

let cleaned = false;

// 1. 清理 execution-record.json 中今天的每日任务记录
try {
  if (fs.existsSync(executionRecordFile)) {
    const record = JSON.parse(fs.readFileSync(executionRecordFile, 'utf-8'));
    const today = getTodayString();
    
    if (record.executions && record.executions[today]) {
      console.log('✓ 找到今天的执行记录');
      console.log(`  日期: ${today}`);
      
      // 获取今天的账号记录
      const todayAccounts = record.executions[today].accounts || {};
      const accountCount = Object.keys(todayAccounts).length;
      
      if (accountCount > 0) {
        console.log(`  清理前: ${accountCount} 个账号`);
        
        // 清空今天的所有账号记录
        record.executions[today].accounts = {};
        record.executions[today].totalAccounts = 0;
        record.executions[today].successAccounts = 0;
        record.executions[today].failedAccounts = 0;
        
        // 保存
        fs.writeFileSync(executionRecordFile, JSON.stringify(record, null, 2), 'utf-8');
        console.log('  ✓ 已清空今天的账号执行记录');
        cleaned = true;
      } else {
        console.log('  ○ 今天还没有执行记录');
      }
    } else {
      console.log('○ 今天还没有执行记录');
    }
  } else {
    console.log('○ 执行记录文件不存在');
  }
} catch (error) {
  console.error('✗ 清理 execution-record.json 失败:', error.message);
}

console.log('');

// 2. 清理 task-schedule-record.json 中每日任务的记录
try {
  if (fs.existsSync(taskScheduleRecordFile)) {
    const record = JSON.parse(fs.readFileSync(taskScheduleRecordFile, 'utf-8'));
    
    if (record['每日任务']) {
      console.log('✓ 找到每日任务调度记录');
      
      const accounts = record['每日任务'].accounts || {};
      const accountCount = Object.keys(accounts).length;
      
      if (accountCount > 0) {
        console.log(`  清理前: ${accountCount} 个账号`);
        
        // 清空每日任务的所有账号记录
        record['每日任务'].accounts = {};
        
        // 保存
        fs.writeFileSync(taskScheduleRecordFile, JSON.stringify(record, null, 2), 'utf-8');
        console.log('  ✓ 已清空每日任务的调度记录');
        cleaned = true;
      } else {
        console.log('  ○ 每日任务还没有调度记录');
      }
    } else {
      console.log('○ 每日任务还没有调度记录');
    }
  } else {
    console.log('○ 调度记录文件不存在');
  }
} catch (error) {
  console.error('✗ 清理 task-schedule-record.json 失败:', error.message);
}

console.log('');
console.log('========================================');
if (cleaned) {
  console.log('✓ 每日任务状态清理完成！');
  console.log('');
  console.log('下次检测时，所有账号将重新执行每日任务');
} else {
  console.log('○ 没有需要清理的记录');
}
console.log('========================================');
console.log('');

// 获取今天的日期字符串
function getTodayString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
