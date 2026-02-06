/**
 * 清空所有任务状态和执行记录
 * 清空后所有任务将重新运行
 * 
 * 用途：测试时清空所有任务状态，让调度器完全重新执行
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const statusFile = path.join(__dirname, '../data/account-status.json');
const recordFile = path.join(__dirname, '../data/task-schedule-record.json');
const executionRecordFile = path.join(__dirname, '../data/execution-record.json');
const binCheckRecordFile = path.join(__dirname, '../data/bin-check-record.json');
const windowStatusFile = path.join(__dirname, '../插件/游戏自动登录/window-status.json');
const cleanupRecordFile = path.join(__dirname, '../data/cleanup-record.json');

console.log('========================================');
console.log('清空所有任务状态');
console.log('========================================\n');

console.log('⚠️  警告：此操作将清空所有任务的状态和记录！');
console.log('⚠️  清空后所有任务将重新运行！\n');

try {
  let accountCount = 0;
  
  // 1. 清空账号状态（保留账号结构，只清空任务相关数据）
  if (fs.existsSync(statusFile)) {
    const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
    
    Object.keys(status).forEach(accountName => {
      // ✅ 保留基础信息，清空所有任务状态
      status[accountName] = {
        lastUpdate: Date.now(),
        dailyTask: { dailyPoint: 0, complete: {} },
        signin: { isSignedIn: false },
        arena: { successCount: 0, attemptCount: 0, status: 'pending', lastExecuteTime: null },
        bottleHelper: { isRunning: false, remainingTime: 0, helperStopTime: 0 },
        hangUp: { totalTime: 0, remainingTime: 0, elapsedTime: 0, lastTime: 0, hangUpTime: 0 },
        study: { hasAnswered: false, score: 0, status: 'pending', beginTime: 0, maxCorrectNum: 0, lastExecuteTime: null },
        carKing: { hasPlayed: false, 已执行日期: [] },
        legionShop: { 购买日期: null, 状态: 'pending', 显示状态: 'pending', 错误信息: null },
        每日咸王: { 状态: 'pending', 执行次数: 0, 成功次数: 0, 最后执行时间: null, 错误信息: null },
        灯神: { 状态: 'pending', 最后执行时间: null },
        BOSS战斗: { 状态: 'pending', 最后执行时间: null },
        俱乐部签到: { 状态: 'pending', 最后执行时间: null },
        梦境: { 状态: 'pending', 最后执行时间: null },
        tower: { 
          towerId: 0, 
          energy: 0, 
          lastExecuteTime: null, 
          today: { challengeCount: 0, successCount: 0, failCount: 0, date: null }, 
          week: { challengeCount: 0, successCount: 0, failCount: 0, initialTowerId: null, currentTowerId: null, weekStartDate: null }, 
          status: 'pending' 
        }
      };
      accountCount++;
    });
    
    fs.writeFileSync(statusFile, JSON.stringify(status, null, 2), 'utf-8');
    console.log(`✓ 已清空 ${accountCount} 个账号的所有任务状态`);
  } else {
    console.log('⚠️  账号状态文件不存在');
  }
  
  // 2. 清空任务调度记录（所有任务的lastExecutionTime）
  if (fs.existsSync(recordFile)) {
    fs.writeFileSync(recordFile, '{}', 'utf-8');
    console.log('✓ 已清空任务调度记录（所有任务的执行时间）');
  } else {
    console.log('⚠️  任务调度记录文件不存在');
  }
  
  // 3. 清空每日任务执行记录
  if (fs.existsSync(executionRecordFile)) {
    fs.writeFileSync(executionRecordFile, '{}', 'utf-8');
    console.log('✓ 已清空每日任务执行记录');
  } else {
    console.log('⚠️  每日任务执行记录文件不存在');
  }
  
  // 4. 清空BIN文件检查记录
  if (fs.existsSync(binCheckRecordFile)) {
    fs.writeFileSync(binCheckRecordFile, JSON.stringify({ count: 0, files: {} }, null, 2), 'utf-8');
    console.log('✓ 已清空BIN文件检查记录（token转换将重新检测）');
  } else {
    console.log('⚠️  BIN文件检查记录文件不存在');
  }
  
  // 5. 清空游戏窗口状态记录
  if (fs.existsSync(windowStatusFile)) {
    fs.writeFileSync(windowStatusFile, '{}', 'utf-8');
    console.log('✓ 已清空游戏窗口状态记录（挂机登录将重新检测）');
  } else {
    console.log('⚠️  游戏窗口状态记录文件不存在');
  }
  
  // 6. 清空清理记录（让每日/每周清理重新执行）
  if (fs.existsSync(cleanupRecordFile)) {
    fs.writeFileSync(cleanupRecordFile, JSON.stringify({
      lastDailyCleanupDate: null,
      lastWeeklyCleanupDate: null,
      lastLogCleanupDate: null
    }, null, 2), 'utf-8');
    console.log('✓ 已清空清理记录（每日/每周清理将重新执行）');
  } else {
    console.log('⚠️  清理记录文件不存在');
  }
  
  // 7. 检查任务配置，提示未启用的任务
  const configFile = path.join(__dirname, '../data/task-config.json');
  if (fs.existsSync(configFile)) {
    const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
    const 账号配置 = config.账号配置 || {};
    
    // 需要检查的任务列表
    const 需要检查的任务 = [
      '每日任务', '竞技场', '挂机奖励', '盐罐机器', '俱乐部签到',
      'BOSS战斗', '每日咸王', '灯神', '梦境', '咸鱼大冲关',
      '疯狂赛车', '军团商店购买', '咸将塔'
    ];
    
    // 统计每个任务的启用情况
    const 任务启用统计 = {};
    需要检查的任务.forEach(任务名称 => {
      任务启用统计[任务名称] = {
        启用账号数: 0,
        未启用账号数: 0,
        未启用账号列表: []
      };
    });
    
    // 遍历所有账号，统计任务启用情况
    Object.keys(账号配置).forEach(账号名称 => {
      const 账号 = 账号配置[账号名称];
      if (!账号 || 账号.启用 === false) {
        // 账号总开关关闭，跳过
        return;
      }
      
      需要检查的任务.forEach(任务名称 => {
        const 任务配置 = 账号[任务名称];
        if (任务配置 && 任务配置.启用 === true) {
          任务启用统计[任务名称].启用账号数++;
        } else {
          任务启用统计[任务名称].未启用账号数++;
          任务启用统计[任务名称].未启用账号列表.push(账号名称);
        }
      });
    });
    
    // 找出未启用账号数 > 0 的任务
    const 未启用任务列表 = 需要检查的任务.filter(任务名称 => {
      return 任务启用统计[任务名称].未启用账号数 > 0;
    });
    
    if (未启用任务列表.length > 0) {
      console.log('\n⚠️  检测到以下任务有账号未启用：');
      console.log('========================================');
      未启用任务列表.forEach(任务名称 => {
        const 统计 = 任务启用统计[任务名称];
        console.log(`\n📌 ${任务名称}:`);
        console.log(`   启用账号: ${统计.启用账号数} 个`);
        console.log(`   未启用账号: ${统计.未启用账号数} 个`);
        if (统计.未启用账号列表.length <= 5) {
          console.log(`   未启用账号列表: ${统计.未启用账号列表.join(', ')}`);
        } else {
          console.log(`   未启用账号列表: ${统计.未启用账号列表.slice(0, 5).join(', ')} ... (共${统计.未启用账号列表.length}个)`);
        }
      });
      console.log('\n💡 提示：');
      console.log('   如果任务未启用，调度器将跳过该任务，不会执行。');
      console.log('   请在 WEB 任务配置界面中启用这些任务，或修改 task-config.json 文件。');
      console.log('========================================\n');
    }
  }
  
  console.log('\n========================================');
  console.log('✅ 清空完成！');
  console.log('========================================');
  console.log('调度器将在下次检测时重新执行所有任务\n');
  console.log('📋 将重新执行的任务（需确保任务已启用）：');
  console.log('  - 每日任务');
  console.log('  - 竞技场');
  console.log('  - 挂机奖励');
  console.log('  - 盐罐机器');
  console.log('  - 俱乐部签到');
  console.log('  - BOSS战斗');
  console.log('  - 每日咸王');
  console.log('  - 灯神');
  console.log('  - 梦境');
  console.log('  - 咸鱼大冲关');
  console.log('  - 疯狂赛车');
  console.log('  - 军团商店购买');
  console.log('  - 咸将塔\n');
  
} catch (error) {
  console.error('❌ 清空失败:', error.message);
  process.exit(1);
}



