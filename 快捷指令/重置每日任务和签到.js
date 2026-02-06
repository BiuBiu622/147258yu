/**
 * 重置每日任务和俱乐部签到状态
 * 清除后会在下次调度时重新执行
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const statusFile = path.join(__dirname, '../data/account-status.json');
const recordFile = path.join(__dirname, '../data/task-schedule-record.json');

console.log('========================================');
console.log('重置每日任务和俱乐部签到状态');
console.log('========================================\n');

try {
  // 1. 清除账号状态中的每日任务和签到
  if (fs.existsSync(statusFile)) {
    const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
    let accountCount = 0;
    
    Object.keys(status).forEach(accountName => {
      let modified = false;
      
      // 清除每日任务状态
      if (status[accountName].dailyTask) {
        status[accountName].dailyTask = {
          dailyPoint: 0,
          complete: {}
        };
        modified = true;
      }
      
      // 清除签到状态
      if (status[accountName].signin) {
        status[accountName].signin.isSignedIn = false;
        modified = true;
      }
      
      if (modified) {
        accountCount++;
      }
    });
    
    fs.writeFileSync(statusFile, JSON.stringify(status, null, 2), 'utf-8');
    console.log(`✓ 已清除 ${accountCount} 个账号的每日任务和签到状态`);
  }
  
  // 2. 清除任务执行记录
  if (fs.existsSync(recordFile)) {
    const record = JSON.parse(fs.readFileSync(recordFile, 'utf-8'));
    let taskCount = 0;
    
    if (record['每日任务']) {
      delete record['每日任务'];
      taskCount++;
    }
    
    if (record['俱乐部签到']) {
      delete record['俱乐部签到'];
      taskCount++;
    }
    
    fs.writeFileSync(recordFile, JSON.stringify(record, null, 2), 'utf-8');
    console.log(`✓ 已清除 ${taskCount} 个任务的执行记录`);
  }
  
  console.log('\n========================================');
  console.log('✅ 重置完成！');
  console.log('========================================');
  console.log('下次调度时将重新执行每日任务和俱乐部签到\n');
  
} catch (error) {
  console.error('❌ 重置失败:', error.message);
  process.exit(1);
}
