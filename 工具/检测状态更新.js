/**
 * 检测各种状态在WEB页面的更新情况
 * 用于验证状态是否正确保存和更新
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { 读取账号状态 } from './账号状态.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 格式化日期
 */
function 格式化日期(dateString) {
  if (!dateString) return '-';
  try {
    const date = new Date(dateString);
    return date.toLocaleString('zh-CN');
  } catch (error) {
    return dateString;
  }
}

/**
 * 获取本周一0点的时间戳
 */
function getThisWeekStart() {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=周日, 1=周一, ...
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // 距离周一的天数
  
  const monday = new Date(now);
  monday.setDate(now.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  
  return monday.getTime();
}

/**
 * 检查是否在本周内
 */
function 是否在本周内(dateString) {
  if (!dateString) return false;
  try {
    const date = new Date(dateString);
    const thisWeekStart = getThisWeekStart();
    return date.getTime() >= thisWeekStart;
  } catch (error) {
    return false;
  }
}

/**
 * 检测单个账号的状态
 */
function 检测账号状态(accountName, status) {
  const 问题列表 = [];
  const 状态列表 = [];
  
  // 1. 检查今日签到
  const signin = status.signin;
  if (signin) {
    const isSignedIn = signin.isSignedIn || false;
    状态列表.push({
      任务: '今日签到',
      状态: isSignedIn ? '✅ 已签到' : '❌ 未签到',
      字段: `signin.isSignedIn = ${isSignedIn}`
    });
  } else {
    问题列表.push('❌ 缺少 signin 字段');
  }
  
  // 2. 检查本周答题
  const study = status.study;
  if (study) {
    const hasAnswered = study.hasAnswered || false;
    const score = study.score || 0;
    const beginTime = study.beginTime || 0;
    const maxCorrectNum = study.maxCorrectNum || 0;
    
    let 答题状态 = '❌ 未完成';
    if (hasAnswered) {
      if (beginTime > 0) {
        const 答题时间 = 格式化日期(new Date(beginTime * 1000).toISOString());
        const 是否本周 = beginTime * 1000 >= getThisWeekStart();
        答题状态 = 是否本周 ? `✅ 已完成(${score}分)` : `⚠️ 已完成但不在本周(${score}分, ${答题时间})`;
      } else {
        答题状态 = `✅ 已完成(${score}分)`;
      }
    }
    
    状态列表.push({
      任务: '本周答题',
      状态: 答题状态,
      字段: `study.hasAnswered = ${hasAnswered}, score = ${score}, beginTime = ${beginTime}, maxCorrectNum = ${maxCorrectNum}`
    });
    
    if (hasAnswered && beginTime === 0 && maxCorrectNum === 0) {
      问题列表.push('⚠️ 答题状态异常：hasAnswered=true 但缺少 beginTime 和 maxCorrectNum');
    }
  } else {
    问题列表.push('❌ 缺少 study 字段');
  }
  
  // 3. 检查疯狂赛车
  const carKing = status.carKing;
  if (carKing) {
    const hasPlayed = carKing.hasPlayed || false;
    const 已执行日期 = carKing.已执行日期 || [];
    const 今天周几 = new Date().getDay();
    const 今天名称 = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][今天周几];
    
    let 赛车状态 = '❌ 未执行';
    if (hasPlayed && 已执行日期.length > 0) {
      const 已有周一 = 已执行日期.includes('周一');
      const 已有周二 = 已执行日期.includes('周二');
      const 已有周三 = 已执行日期.includes('周三');
      const 本周已完成 = 已有周一 && 已有周二 && 已有周三;
      
      if (本周已完成) {
        赛车状态 = '✅ 本周已执行完毕';
      } else {
        if (已执行日期.includes(今天名称)) {
          赛车状态 = `✅ ${今天名称}已执行`;
        } else {
          赛车状态 = `✅ 已执行: ${已执行日期.join('、')}`;
        }
      }
    } else if (hasPlayed && 已执行日期.length === 0) {
      赛车状态 = '⚠️ hasPlayed=true 但 已执行日期为空数组';
      问题列表.push('⚠️ 疯狂赛车状态异常：hasPlayed=true 但 已执行日期为空数组');
    }
    
    状态列表.push({
      任务: '疯狂赛车',
      状态: 赛车状态,
      字段: `carKing.hasPlayed = ${hasPlayed}, 已执行日期 = [${已执行日期.join(', ')}]`
    });
  } else {
    问题列表.push('❌ 缺少 carKing 字段');
  }
  
  // 4. 检查四圣碎片购买（军团商店购买）
  const legionShop = status.legionShop;
  if (legionShop) {
    const 状态 = legionShop.状态 || 'pending';
    const 显示状态 = legionShop.显示状态 || 状态;
    const 购买日期 = legionShop.购买日期;
    const 错误信息 = legionShop.错误信息 || '';
    const 更新时间 = legionShop.更新时间;
    
    let 购买状态 = '❌ 未购买';
    if (显示状态 === 'purchased') {
      购买状态 = '✅ 购买成功';
    } else if (显示状态 === 'insufficient') {
      购买状态 = '⚠️ 道具不足';
    } else if (显示状态 === 'timeout') {
      购买状态 = '⚠️ 超时';
    } else if (显示状态 === 'failed') {
      购买状态 = `❌ 失败(${错误信息})`;
    } else if (显示状态 === 'pending') {
      购买状态 = '⚠️ 购买中';
    }
    
    // 检查状态一致性
    if (状态 !== 显示状态) {
      问题列表.push(`⚠️ 四圣碎片购买状态不一致：状态=${状态}, 显示状态=${显示状态}`);
    }
    
    // 检查购买日期
    if (购买日期) {
      const 是否本周 = 是否在本周内(购买日期);
      if (!是否本周) {
        问题列表.push(`⚠️ 四圣碎片购买日期不在本周：${格式化日期(购买日期)}`);
      }
    } else if (显示状态 === 'purchased' || 显示状态 === 'insufficient') {
      问题列表.push(`⚠️ 四圣碎片购买状态为${显示状态}但缺少购买日期`);
    }
    
    状态列表.push({
      任务: '四圣碎片购买',
      状态: 购买状态,
      字段: `legionShop.状态 = ${状态}, 显示状态 = ${显示状态}, 购买日期 = ${购买日期 ? 格式化日期(购买日期) : 'null'}, 错误信息 = ${错误信息 || 'null'}`
    });
  } else {
    问题列表.push('❌ 缺少 legionShop 字段');
  }
  
  // 5. 检查每日咸王
  const 每日咸王 = status.每日咸王;
  if (每日咸王) {
    const 状态 = 每日咸王.状态 || 'pending';
    const 执行次数 = 每日咸王.执行次数 || 0;
    const 成功次数 = 每日咸王.成功次数 || 0;
    const 最后执行时间 = 每日咸王.最后执行时间;
    const 错误信息 = 每日咸王.错误信息 || '';
    
    let 咸王状态 = '❌ 未执行';
    if (状态 === 'success') {
      咸王状态 = `✅ 已完成(${成功次数}/1)`;
    } else if (状态 === 'failed') {
      咸王状态 = `❌ 失败(${执行次数}次) - ${错误信息}`;
    } else if (执行次数 > 0) {
      咸王状态 = `⚠️ 执行中(${执行次数}次)`;
    }
    
    状态列表.push({
      任务: '每日咸王',
      状态: 咸王状态,
      字段: `每日咸王.状态 = ${状态}, 执行次数 = ${执行次数}, 成功次数 = ${成功次数}, 最后执行时间 = ${最后执行时间 ? 格式化日期(最后执行时间) : 'null'}`
    });
  } else {
    问题列表.push('❌ 缺少 每日咸王 字段');
  }
  
  // 6. 检查 lastUpdate
  const lastUpdate = status.lastUpdate;
  if (!lastUpdate) {
    问题列表.push('❌ 缺少 lastUpdate 字段');
  } else {
    const 更新时间 = 格式化日期(new Date(lastUpdate).toISOString());
    const 更新间隔 = Date.now() - lastUpdate;
    const 更新间隔分钟 = Math.floor(更新间隔 / 60000);
    
    if (更新间隔 > 24 * 60 * 60 * 1000) {
      问题列表.push(`⚠️ 状态超过24小时未更新：${更新时间} (${更新间隔分钟}分钟前)`);
    }
  }
  
  return {
    账号名称: accountName,
    问题列表,
    状态列表,
    最后更新: lastUpdate ? 格式化日期(new Date(lastUpdate).toISOString()) : '-',
    更新间隔: lastUpdate ? Math.floor((Date.now() - lastUpdate) / 60000) : null
  };
}

/**
 * 主函数
 */
function main() {
  console.log('');
  console.log('========================================');
  console.log('    检测各种状态在WEB页面的更新情况');
  console.log('========================================');
  console.log('');
  
  try {
    const allStatus = 读取账号状态();
    const accountNames = Object.keys(allStatus);
    
    if (accountNames.length === 0) {
      console.log('❌ 没有找到任何账号状态数据');
      return;
    }
    
    console.log(`找到 ${accountNames.length} 个账号的状态数据`);
    console.log('');
    
    let 总问题数 = 0;
    const 检测结果 = [];
    
    // 检测每个账号
    for (const accountName of accountNames) {
      const status = allStatus[accountName];
      const 结果 = 检测账号状态(accountName, status);
      检测结果.push(结果);
      总问题数 += 结果.问题列表.length;
    }
    
    // 输出检测结果
    for (const 结果 of 检测结果) {
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`账号: ${结果.账号名称}`);
      console.log(`最后更新: ${结果.最后更新}${结果.更新间隔 !== null ? ` (${结果.更新间隔}分钟前)` : ''}`);
      console.log('');
      
      // 输出状态列表
      console.log('📋 状态列表:');
      for (const 状态 of 结果.状态列表) {
        console.log(`  ${状态.任务}: ${状态.状态}`);
        console.log(`    字段: ${状态.字段}`);
      }
      console.log('');
      
      // 输出问题列表
      if (结果.问题列表.length > 0) {
        console.log('⚠️ 发现问题:');
        for (const 问题 of 结果.问题列表) {
          console.log(`  ${问题}`);
        }
        console.log('');
      } else {
        console.log('✅ 未发现问题');
        console.log('');
      }
    }
    
    // 输出统计信息
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 统计信息:');
    console.log(`  总账号数: ${accountNames.length}`);
    console.log(`  总问题数: ${总问题数}`);
    console.log(`  有问题的账号: ${检测结果.filter(r => r.问题列表.length > 0).length}`);
    console.log(`  无问题的账号: ${检测结果.filter(r => r.问题列表.length === 0).length}`);
    console.log('');
    
    // 输出问题汇总
    if (总问题数 > 0) {
      console.log('📋 问题汇总:');
      const 问题统计 = {};
      for (const 结果 of 检测结果) {
        for (const 问题 of 结果.问题列表) {
          const 问题类型 = 问题.split(':')[0] || 问题;
          if (!问题统计[问题类型]) {
            问题统计[问题类型] = [];
          }
          问题统计[问题类型].push(`${结果.账号名称}: ${问题}`);
        }
      }
      
      for (const [问题类型, 问题列表] of Object.entries(问题统计)) {
        console.log(`  ${问题类型}: ${问题列表.length}个`);
        for (const 问题 of 问题列表.slice(0, 5)) { // 只显示前5个
          console.log(`    - ${问题}`);
        }
        if (问题列表.length > 5) {
          console.log(`    ... 还有 ${问题列表.length - 5} 个`);
        }
      }
      console.log('');
    }
    
    console.log('========================================');
    console.log('检测完成');
    console.log('========================================');
    console.log('');
    
  } catch (error) {
    console.error('检测失败:', error.message);
    console.error(error);
  }
}

// 执行检测
main();

