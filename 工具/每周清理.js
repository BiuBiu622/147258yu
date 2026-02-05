/**
 * 每周状态清理工具
 * 负责清理所有需要每周重置的状态
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const statusFile = path.join(__dirname, '../data/account-status.json');

/**
 * 清除每周账号状态
 */
export function 清除每周账号状态() {
  try {
    if (!fs.existsSync(statusFile)) {
      return 0;
    }
    
    const allStatus = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
    let cleanedCount = 0;
    
    Object.keys(allStatus).forEach(accountName => {
      const status = allStatus[accountName];
      let modified = false;
      
      // 答题状态（每周一重置）
      if (status.study) {
        status.study.hasAnswered = false;
        status.study.score = 0;
        status.study.status = 'pending';
        status.study.failReason = null;
        status.study.beginTime = 0;
        status.study.maxCorrectNum = 0;
        modified = true;
      }
      
      // 疯狂赛车状态（每周一重置）
      // ✅ 清除所有详细数据，只保留基础结构，避免其他任务覆盖
      // 详细数据（已发车数量、品阶统计、车辆详情等）由疯狂赛车任务在周一执行时重新获取
      if (status.carKing) {
        status.carKing = {
          hasPlayed: false,
          已执行日期: []
          // 其他详细数据（已发车数量、品阶统计、车辆详情等）在周一执行时重新获取
        };
        modified = true;
      }
      
      // 军团商店购买状态（每周一重置）
      if (status.legionShop) {
        status.legionShop.购买日期 = null;
        status.legionShop.状态 = 'pending';
        status.legionShop.错误信息 = null;
        status.legionShop.更新时间 = new Date().toISOString();
        modified = true;
      }
      
      // 宝库状态（每周重置，周三开始新周期）
      if (status.宝库) {
        status.宝库.状态 = 'pending';
        status.宝库.最后执行时间 = null;
        status.宝库.任务数量 = 0;
        modified = true;
      }
      
      // 咸将塔本周统计（每周清理）
      if (status.tower) {
        // 获取本周周一日期字符串
        const now = new Date();
        const day = now.getDay();
        const diff = now.getDate() - day + (day === 0 ? -6 : 1); // 周一
        const monday = new Date(now.setDate(diff));
        monday.setHours(0, 0, 0, 0);
        const 本周周一 = monday.toDateString();
        
        // 重置本周统计，但保留当前层数作为初始层数
        const 当前towerId = status.tower.towerId || 0;
        status.tower.week = {
          challengeCount: 0,
          successCount: 0,
          failCount: 0,
          initialTowerId: 当前towerId, // 记录本周初始层数
          currentTowerId: 当前towerId, // 当前层数（初始时等于初始层数）
          weekStartDate: 本周周一
        };
        modified = true;
      }
      
      if (modified) {
        cleanedCount++;
      }
    });
    
    if (cleanedCount > 0) {
      fs.writeFileSync(statusFile, JSON.stringify(allStatus, null, 2), 'utf-8');
      console.log(`✅ 已清除 ${cleanedCount} 个账号的每周状态`);
    }
    
    return cleanedCount;
  } catch (error) {
    console.error('❌ 清除每周账号状态失败:', error.message);
    return 0;
  }
}

/**
 * 每周清理主函数
 * 清除所有需要每周重置的状态
 */
export function 执行每周清理() {
  console.log('🗑️ 开始执行每周状态清理...');
  
  const startTime = Date.now();
  
  // 清除每周账号状态
  const accountCount = 清除每周账号状态();
  
  const duration = Date.now() - startTime;
  console.log(`✅ 每周状态清理完成，耗时: ${duration}ms`);
  console.log(`📊 清理统计: ${accountCount} 个账号状态已重置`);
}