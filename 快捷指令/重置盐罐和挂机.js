/**
 * 重置盐罐机器和挂机奖励状态
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
console.log('重置盐罐机器和挂机奖励状态');
console.log('========================================\n');

try {
  // 1. 清除账号状态
  if (fs.existsSync(statusFile)) {
    const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
    let accountCount = 0;
    
    Object.keys(status).forEach(accountName => {
      let modified = false;
      
      // 清除盐罐机器状态
      if (status[accountName].bottleHelper) {
        delete status[accountName].bottleHelper;
        modified = true;
      }
      
      // 挂机奖励没有状态记录，只清除执行时间即可
      
      if (modified) {
        accountCount++;
      }
    });
    
    fs.writeFileSync(statusFile, JSON.stringify(status, null, 2), 'utf-8');
    console.log(`✓ 已清除 ${accountCount} 个账号的盐罐机器状态`);
  }
  
  // 2. 清除任务执行记录
  if (fs.existsSync(recordFile)) {
    const record = JSON.parse(fs.readFileSync(recordFile, 'utf-8'));
    let taskCount = 0;
    
    if (record['盐罐机器']) {
      delete record['盐罐机器'];
      taskCount++;
    }
    
    if (record['挂机奖励']) {
      delete record['挂机奖励'];
      taskCount++;
    }
    
    fs.writeFileSync(recordFile, JSON.stringify(record, null, 2), 'utf-8');
    console.log(`✓ 已清除 ${taskCount} 个任务的执行记录`);
  }
  
  console.log('\n========================================');
  console.log('✅ 重置完成！');
  console.log('========================================');
  console.log('下次调度时将重新执行盐罐机器和挂机奖励\n');
  
} catch (error) {
  console.error('❌ 重置失败:', error.message);
  process.exit(1);
}
