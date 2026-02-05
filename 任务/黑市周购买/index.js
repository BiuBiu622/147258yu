/**
 * 黑市周购买任务
 * 执行逻辑：仅在黑市周期间执行购买
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { 创建WebSocket客户端 } from '../../工具/WebSocket客户端.js';
import { 成功日志, 错误日志, 信息日志, 警告日志 } from '../../工具/日志工具.js';
import { 获取账号配置, 任务是否启用 } from '../../工具/任务配置.js';
import { 更新账号状态, 获取账号状态 } from '../../工具/账号状态.js';
import { 获取当前活动周类型, 获取当前活动周开始时间 } from '../../工具/活动周判断.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取tokens
function 读取Tokens() {
  const tokensPath = path.join(__dirname, '../../data/tokens.json');
  return JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
}

/**
 * 检查是否在购买时间窗口内（周五12:00 - 下周四23:00）
 */
function 是否在购买时间窗口内(now = new Date()) {
  const 当前时间 = new Date(now);
  const 今天周几 = 当前时间.getDay(); // 0=周日, 1=周一, ..., 5=周五, 6=周六
  const 当前小时 = 当前时间.getHours();
  
  // 周五：12:00之后才开放
  if (今天周几 === 5) {
    return 当前小时 >= 12;
  }
  
  // 周六、周日、周一、周二、周三：全天开放
  if (今天周几 === 6 || 今天周几 === 0 || 今天周几 === 1 || 今天周几 === 2 || 今天周几 === 3) {
    return true;
  }
  
  // 周四：23:00之前开放，23:00之后关闭（即23:59之前都可以）
  if (今天周几 === 4) {
    return 当前小时 < 23;
  }
  
  return false;
}

/**
 * 检查是否在本活动周内已购买
 */
function 是否在本活动周内已购买(accountName) {
  try {
    const accountStatus = 获取账号状态(accountName);
    if (!accountStatus || !accountStatus.blackMarketWeek) return false;
    
    const purchaseDate = accountStatus.blackMarketWeek.购买日期;
    if (!purchaseDate) return false;
    
    // 判断是否在本活动周内
    const purchaseTime = new Date(purchaseDate);
    const now = new Date();
    const 当前活动周开始时间 = 获取当前活动周开始时间(now);
    
    return purchaseTime.getTime() >= 当前活动周开始时间.getTime();
  } catch (error) {
    警告日志(`检查购买状态失败: ${error.message}`);
    return false;
  }
}

/**
 * 更新购买状态（简化版：只记录执行时间）
 */
function 更新购买状态(accountName, 购买的商品列表 = []) {
  try {
    更新账号状态(accountName, {
      blackMarketWeek: {
        购买日期: new Date().toISOString(),
        已购买商品: 购买的商品列表,
        更新时间: new Date().toISOString()
      }
    });
    
    信息日志(`[${accountName}] 购买状态已更新`);
  } catch (error) {
    警告日志(`更新购买状态失败: ${error.message}`);
  }
}

/**
 * 发送购买指令（简化版：不等待响应，不判断成功失败）
 */
function 发送购买指令(client, accountName, activityId, goodsIndex, 商品名称) {
  信息日志(`[${accountName}] 发送购买指令：${商品名称} (activityId: ${activityId}, goodsIndex: ${goodsIndex})`);
  client.ws.send('activity_buystoregoods', {
    activityId,
    buyNum: 1,
    goodsIndex
  });
}

/**
 * 执行单个账号的黑市周购买任务
 * @param {object} client - WebSocket客户端
 * @param {string} accountName - 账号名称
 * @returns {Promise<object>} 执行结果
 */
async function 执行黑市周购买(client, accountName) {
  信息日志(`[${accountName}] 开始黑市周购买任务...`);
  
  try {
    // 1. 检查是否在购买时间窗口内（周五12:00 - 下周四23:00）
    if (!是否在购买时间窗口内()) {
      const now = new Date();
      const 今天周几 = now.getDay();
      const 当前小时 = now.getHours();
      if (今天周几 === 5 && 当前小时 < 12) {
        信息日志(`[${accountName}] 当前时间未到周五12:00，跳过`);
      } else if (今天周几 === 4 && 当前小时 >= 23) {
        信息日志(`[${accountName}] 当前时间已过周四23:00，购买窗口已关闭，跳过`);
      } else {
        信息日志(`[${accountName}] 当前时间不在购买窗口内，跳过`);
      }
      return { success: true, skipped: true };
    }
    
    // 2. 检查是否在本活动周内已购买
    if (是否在本活动周内已购买(accountName)) {
      成功日志(`[${accountName}] 本活动周已购买，跳过`);
      return { success: true, skipped: true };
    }
    
    // 3. 获取任务配置
    const 任务配置 = 获取账号配置(accountName);
    const 黑市周配置 = 任务配置?.黑市周购买;
    
    if (!黑市周配置) {
      警告日志(`[${accountName}] 未找到黑市周购买配置，跳过`);
      return { success: false, error: '未找到配置' };
    }
    
    // 4. 检查总开关
    if (!黑市周配置.启用) {
      信息日志(`[${accountName}] 黑市周购买总开关已关闭，跳过`);
      return { success: true, skipped: true };
    }
    
    // 5. 等待连接稳定
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const 已购买商品列表 = [];
    
    // 6. 先领取免费福利（无需开关，默认领取）
    信息日志(`[${accountName}] 开始领取免费福利...`);
    
    // 免费福利1：200金砖 (activityId: 5, goodsIndex: 0)
    发送购买指令(client, accountName, 5, 0, '免费福利200金砖');
    已购买商品列表.push('免费福利200金砖');
    await new Promise(resolve => setTimeout(resolve, 500)); // 500毫秒延迟
    
    // 免费福利2：500金砖 (activityId: 9, goodsIndex: 0)
    发送购买指令(client, accountName, 9, 0, '免费福利500金砖');
    已购买商品列表.push('免费福利500金砖');
    await new Promise(resolve => setTimeout(resolve, 500)); // 500毫秒延迟
    
    // 7. 根据子开关执行购买
    信息日志(`[${accountName}] 开始购买商品...`);
    
    // 购买宝箱 (activityId: 9, goodsIndex: 4)
    if (黑市周配置.购买宝箱) {
      发送购买指令(client, accountName, 9, 4, '购买宝箱');
      已购买商品列表.push('购买宝箱');
      await new Promise(resolve => setTimeout(resolve, 500)); // 500毫秒延迟
    } else {
      信息日志(`[${accountName}] 购买宝箱开关已关闭，跳过`);
    }
    
    // 购买金鱼杆 (activityId: 9, goodsIndex: 6)
    if (黑市周配置.购买金鱼杆) {
      发送购买指令(client, accountName, 9, 6, '购买金鱼杆');
      已购买商品列表.push('购买金鱼杆');
      await new Promise(resolve => setTimeout(resolve, 500)); // 500毫秒延迟
    } else {
      信息日志(`[${accountName}] 购买金鱼杆开关已关闭，跳过`);
    }
    
    // 购买贝壳 (activityId: 9, goodsIndex: 8)
    if (黑市周配置.购买贝壳) {
      发送购买指令(client, accountName, 9, 8, '购买贝壳');
      已购买商品列表.push('购买贝壳');
      await new Promise(resolve => setTimeout(resolve, 500)); // 500毫秒延迟
    } else {
      信息日志(`[${accountName}] 购买贝壳开关已关闭，跳过`);
    }
    
    // 购买白玉 (activityId: 9, goodsIndex: 7)
    if (黑市周配置.购买白玉) {
      发送购买指令(client, accountName, 9, 7, '购买白玉');
      已购买商品列表.push('购买白玉');
      await new Promise(resolve => setTimeout(resolve, 500)); // 500毫秒延迟
    } else {
      信息日志(`[${accountName}] 购买白玉开关已关闭，跳过`);
    }
    
    // 8. 更新购买状态（默认成功，记录执行时间）
    更新购买状态(accountName, 已购买商品列表);
    信息日志(`[${accountName}] 已记录购买状态，本活动周内将不再重复购买`);
    
    成功日志(`[${accountName}] 黑市周购买任务完成`);
    return { success: true, 已购买商品列表 };
    
  } catch (error) {
    错误日志(`[${accountName}] 黑市周购买任务失败: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// 主函数
async function main() {
  try {
    // 检查是否有指定账号参数
    const accountIndex = process.argv.indexOf('--account');
    const 指定账号 = accountIndex !== -1 ? process.argv[accountIndex + 1] : null;
    
    if (指定账号) {
      // 单账号模式（由调度器调用）
      await 执行单个账号模式(指定账号);
    } else {
      // 全部账号模式（手动执行）
      await 执行全部账号模式();
    }
  } catch (error) {
    错误日志('执行失败:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// 单账号模式（由调度器调用）
async function 执行单个账号模式(账号名称) {
  信息日志(`======== 单账号模式: ${账号名称} ========`);
  
  // 检查当前是否是黑市周
  const 当前活动周类型 = 获取当前活动周类型();
  if (当前活动周类型 !== '黑市周') {
    信息日志(`当前是${当前活动周类型}，不是黑市周，跳过任务`);
    process.exit(0);
  }
  
  // 读取tokens
  const tokens = 读取Tokens();
  
  // 查找指定账号
  const tokenData = tokens.find(t => t.name === 账号名称);
  
  if (!tokenData) {
    错误日志(`未找到账号: ${账号名称}`);
    process.exit(1);
  }
  
  // 检查账号是否启用
  const 账号配置 = 获取账号配置(账号名称);
  if (!账号配置 || !账号配置.启用) {
    警告日志(`账号未启用，跳过`);
    process.exit(0);
  }
  
  // 检查任务是否启用
  if (!任务是否启用(账号名称, '黑市周购买')) {
    警告日志(`黑市周购买任务未启用，跳过`);
    process.exit(0);
  }
  
  try {
    const client = 创建WebSocket客户端();
    
    // 连接
    await client.连接(tokenData.token);
    成功日志(`连接成功`);
    
    // 等待连接稳定
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 执行任务
    const result = await 执行黑市周购买(client, 账号名称);
    
    // 等待最后一次命令处理完成
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 断开连接
    client.断开连接();
    
    if (result.success) {
      成功日志('执行完成');
      process.exit(0);
    } else {
      警告日志(`执行失败: ${result.error}`);
      process.exit(0);
    }
  } catch (error) {
    错误日志(`执行失败: ${error.message}`);
    process.exit(0);
  }
}

// 全部账号模式（手动执行）
async function 执行全部账号模式() {
  // 检查当前是否是黑市周
  const 当前活动周类型 = 获取当前活动周类型();
  if (当前活动周类型 !== '黑市周') {
    信息日志(`当前是${当前活动周类型}，不是黑市周，跳过任务`);
    return;
  }
  
  // ✅ 检查是否在购买时间窗口内（周五12:00 - 下周四23:00）
  if (!是否在购买时间窗口内()) {
    const now = new Date();
    const 今天周几 = now.getDay();
    const 当前小时 = now.getHours();
    if (今天周几 === 5 && 当前小时 < 12) {
      信息日志(`当前时间未到周五12:00，跳过任务`);
    } else if (今天周几 === 4 && 当前小时 >= 23) {
      信息日志(`当前时间已过周四23:00，购买窗口已关闭，跳过任务`);
    } else {
      信息日志(`当前时间不在购买窗口内，跳过任务`);
    }
    return;
  }
  
  信息日志('============================================================');
  信息日志('       黑市周购买任务');
  信息日志('============================================================');
  信息日志('');
  
  const tokens = 读取Tokens();
  信息日志(`总计 ${tokens.length} 个账号`);
  信息日志('');
  
  let successCount = 0;
  let failedCount = 0;
  
  // 顺序执行每个账号
  for (let i = 0; i < tokens.length; i++) {
    const tokenInfo = tokens[i];
    const accountName = tokenInfo.name;
    
    // 检查账号是否启用
    const 账号配置 = 获取账号配置(accountName);
    if (!账号配置 || !账号配置.启用) {
      警告日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 账号未启用，跳过`);
      continue;
    }
    
    // 检查任务是否启用
    if (!任务是否启用(accountName, '黑市周购买')) {
      警告日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 黑市周购买任务未启用，跳过`);
      continue;
    }
    
    信息日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 正在处理...`);
    
    try {
      const client = 创建WebSocket客户端();
      
      // 连接
      await client.连接(tokenInfo.token);
      成功日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 连接成功`);
      
      // 执行任务
      const result = await 执行黑市周购买(client, accountName);
      
      // 断开连接
      client.断开连接();
      
      if (result.success) {
        successCount++;
      } else {
        failedCount++;
      }
      
      信息日志('');
      
    } catch (error) {
      错误日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 处理失败: ${error.message}`);
      failedCount++;
      信息日志('');
    }
  }
  
  信息日志('============================================================');
  成功日志(`黑市周购买任务完成！成功: ${successCount}, 失败: ${failedCount}`);
  信息日志('============================================================');
}

// 启动
main();

