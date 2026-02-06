/**
 * 重置疯狂赛车和咸鱼大冲关状态
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
console.log('重置疯狂赛车和咸鱼大冲关状态');
console.log('========================================\n');

try {
  // 1. 清除账号状态
  if (fs.existsSync(statusFile)) {
    const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
    let accountCount = 0;
    
    Object.keys(status).forEach(accountName => {
      let modified = false;
      
      // 清除疯狂赛车状态
      if (status[accountName].carKing) {
        delete status[accountName].carKing;
        modified = true;
      }
      
      // 咸鱼大冲关没有状态记录，只清除执行时间即可
      
      if (modified) {
        accountCount++;
      }
    });
    
    fs.writeFileSync(statusFile, JSON.stringify(status, null, 2), 'utf-8');
    console.log(`✓ 已清除 ${accountCount} 个账号的疯狂赛车状态`);
  }
  
  // 2. 清除任务执行记录
  if (fs.existsSync(recordFile)) {
    const record = JSON.parse(fs.readFileSync(recordFile, 'utf-8'));
    let taskCount = 0;
    
    if (record['疯狂赛车']) {
      delete record['疯狂赛车'];
      taskCount++;
    }
    
    if (record['咸鱼大冲关']) {
      delete record['咸鱼大冲关'];
      taskCount++;
    }
    
    fs.writeFileSync(recordFile, JSON.stringify(record, null, 2), 'utf-8');
    console.log(`✓ 已清除 ${taskCount} 个任务的执行记录`);
  }
  
  console.log('\n========================================');
  console.log('✅ 重置完成！');
  console.log('========================================');
  console.log('疯狂赛车：下次周一、二、三的8点或18点重新执行');
  console.log('咸鱼大冲关：下次周一重新执行\n');
  
} catch (error) {
  console.error('❌ 重置失败:', error.message);
  process.exit(1);
}
