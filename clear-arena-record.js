/**
 * 清除竞技场任务执行时间记录
 * 运行后竞技场任务将立即重新执行
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const taskScheduleRecordFile = path.join(__dirname, 'data/task-schedule-record.json');
const executionRecordFile = path.join(__dirname, 'data/execution-record.json');

console.log('========================================');
console.log('  清除竞技场任务执行时间记录');
console.log('========================================');
console.log('');
console.log('目的：让竞技场任务立即重新执行');
console.log('');

let cleaned = false;

// 1. 清除 task-schedule-record.json 中竞技场的执行时间
try {
  if (fs.existsSync(taskScheduleRecordFile)) {
    const record = JSON.parse(fs.readFileSync(taskScheduleRecordFile, 'utf-8'));
    
    if (record['竞技场'] && record['竞技场'].accounts) {
      const accountCount = Object.keys(record['竞技场'].accounts).length;
      
      if (accountCount > 0) {
        console.log(`[1/2] 清除任务调度记录`);
        console.log(`  ✓ 找到 ${accountCount} 个账号的竞技场执行记录`);
        
        // 清除所有账号的执行时间
        Object.keys(record['竞技场'].accounts).forEach(accountName => {
          delete record['竞技场'].accounts[accountName].lastExecutionTime;
          delete record['竞技场'].accounts[accountName].lastStatus;
        });
        
        // 保存
        fs.writeFileSync(taskScheduleRecordFile, JSON.stringify(record, null, 2), 'utf-8');
        console.log(`  ✓ 已清除所有账号的执行时间记录`);
        cleaned = true;
      } else {
        console.log(`[1/2] 清除任务调度记录`);
        console.log(`  ○ 竞技场没有执行记录`);
      }
    } else {
      console.log(`[1/2] 清除任务调度记录`);
      console.log(`  ○ 竞技场任务记录不存在`);
    }
  } else {
    console.log(`[1/2] 清除任务调度记录`);
    console.log(`  ○ 任务调度记录文件不存在`);
  }
} catch (error) {
  console.error(`[1/2] 清除任务调度记录`);
  console.error(`  ✗ 失败: ${error.message}`);
}

console.log('');

// 2. 清除 execution-record.json 中今天的记录（让账号今天已执行检查失效）
try {
  if (fs.existsSync(executionRecordFile)) {
    const record = JSON.parse(fs.readFileSync(executionRecordFile, 'utf-8'));
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD格式
    
    if (record.executions && record.executions[today]) {
      const accountCount = Object.keys(record.executions[today].accounts || {}).length;
      
      if (accountCount > 0) {
        console.log(`[2/2] 清除今日执行记录`);
        console.log(`  ✓ 找到今天（${today}）的执行记录`);
        console.log(`  ✓ 涉及 ${accountCount} 个账号`);
        
        // 清空今天的所有账号记录
        record.executions[today].accounts = {};
        record.executions[today].totalAccounts = 0;
        record.executions[today].successAccounts = 0;
        record.executions[today].failedAccounts = 0;
        
        // 保存
        fs.writeFileSync(executionRecordFile, JSON.stringify(record, null, 2), 'utf-8');
        console.log(`  ✓ 已清空今天的账号执行记录`);
        cleaned = true;
      } else {
        console.log(`[2/2] 清除今日执行记录`);
        console.log(`  ○ 今天还没有执行记录`);
      }
    } else {
      console.log(`[2/2] 清除今日执行记录`);
      console.log(`  ○ 今天还没有执行记录`);
    }
  } else {
    console.log(`[2/2] 清除今日执行记录`);
    console.log(`  ○ 执行记录文件不存在`);
  }
} catch (error) {
  console.error(`[2/2] 清除今日执行记录`);
  console.error(`  ✗ 失败: ${error.message}`);
}

console.log('');

if (cleaned) {
  console.log('========================================');
  console.log('✅ 清除完成！');
  console.log('========================================');
  console.log('');
  console.log('竞技场任务将在下次调度时立即重新执行');
  console.log('（调度器每20秒检测一次，最多等待20秒）');
  console.log('');
  console.log('⚠️  注意：已清空今天的执行记录，');
  console.log('   其他任务的执行记录也会被清除，');
  console.log('   如果需要，它们也会重新执行。');
} else {
  console.log('========================================');
  console.log('ℹ️  没有找到需要清除的记录');
  console.log('========================================');
  console.log('');
  console.log('竞技场任务可能从未执行过，');
  console.log('或者记录已被清除。');
}

console.log('');

