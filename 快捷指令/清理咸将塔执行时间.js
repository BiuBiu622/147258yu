/**
 * 清理咸将塔任务的执行时间记录
 * 清除后会在下次调度时重新执行
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const recordFile = path.join(__dirname, '../data/task-schedule-record.json');
const statusFile = path.join(__dirname, '../data/account-status.json');

console.log('========================================');
console.log('清理咸将塔执行时间记录');
console.log('========================================\n');

try {
  let 清理账号数 = 0;
  
  // 1. 清理 task-schedule-record.json 中的记录
  if (fs.existsSync(recordFile)) {
    const record = JSON.parse(fs.readFileSync(recordFile, 'utf-8'));
    
    // 检查是否存在"咸将塔"任务记录
    if (record['咸将塔']) {
      const 咸将塔记录 = record['咸将塔'];
      
      // 清理所有账号的执行时间记录
      if (咸将塔记录.accounts) {
        Object.keys(咸将塔记录.accounts).forEach(账号名称 => {
          // 删除执行时间相关字段，但保留账号结构
          delete 咸将塔记录.accounts[账号名称].lastExecutionTime;
          delete 咸将塔记录.accounts[账号名称].lastStatus;
          // 如果有dailyRecord也删除
          if (咸将塔记录.accounts[账号名称].dailyRecord) {
            delete 咸将塔记录.accounts[账号名称].dailyRecord;
          }
        });
      }
      
      // 保存清理后的记录
      fs.writeFileSync(recordFile, JSON.stringify(record, null, 2), 'utf-8');
      console.log('✓ 已清理 task-schedule-record.json 中的记录');
    } else {
      console.log('⚠️  task-schedule-record.json 中未找到"咸将塔"任务记录');
    }
  } else {
    console.log('⚠️  task-schedule-record.json 文件不存在');
  }
  
  // 2. 清理 account-status.json 中的 tower.lastExecuteTime
  if (fs.existsSync(statusFile)) {
    const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
    let 清理状态账号数 = 0;
    
    Object.keys(status).forEach(账号名称 => {
      if (status[账号名称] && status[账号名称].tower && status[账号名称].tower.lastExecuteTime) {
        delete status[账号名称].tower.lastExecuteTime;
        清理状态账号数++;
        清理账号数++;
      }
    });
    
    if (清理状态账号数 > 0) {
      // 保存清理后的状态
      fs.writeFileSync(statusFile, JSON.stringify(status, null, 2), 'utf-8');
      console.log(`✓ 已清理 account-status.json 中 ${清理状态账号数} 个账号的 tower.lastExecuteTime`);
    } else {
      console.log('⚠️  account-status.json 中未找到需要清理的记录');
    }
  } else {
    console.log('⚠️  account-status.json 文件不存在');
  }
  
  console.log('\n========================================');
  console.log(`✅ 清理完成！共清理 ${清理账号数} 个账号的执行时间记录`);
  console.log('========================================');
  console.log('下次调度时将重新执行"咸将塔"任务\n');
  
} catch (error) {
  console.error('❌ 清理失败:', error.message);
  console.error(error.stack);
  process.exit(1);
}

