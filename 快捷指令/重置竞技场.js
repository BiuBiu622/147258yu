/**
 * 重置竞技场状态
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
console.log('重置竞技场状态');
console.log('========================================\n');

try {
  // 1. 清除账号状态中的竞技场
  if (fs.existsSync(statusFile)) {
    const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
    let accountCount = 0;
    
    Object.keys(status).forEach(accountName => {
      if (status[accountName].arena) {
        delete status[accountName].arena;
        accountCount++;
      }
    });
    
    fs.writeFileSync(statusFile, JSON.stringify(status, null, 2), 'utf-8');
    console.log(`✓ 已清除 ${accountCount} 个账号的竞技场状态`);
  }
  
  // 2. 清除任务执行记录
  if (fs.existsSync(recordFile)) {
    const record = JSON.parse(fs.readFileSync(recordFile, 'utf-8'));
    
    if (record['竞技场']) {
      delete record['竞技场'];
      console.log('✓ 已清除竞技场执行记录');
    }
    
    fs.writeFileSync(recordFile, JSON.stringify(record, null, 2), 'utf-8');
  }
  
  console.log('\n========================================');
  console.log('✅ 重置完成！');
  console.log('========================================');
  console.log('下次调度时将重新执行竞技场任务\n');
  
} catch (error) {
  console.error('❌ 重置失败:', error.message);
  process.exit(1);
}
