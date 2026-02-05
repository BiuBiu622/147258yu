/**
 * 咸鱼大冲关任务 - 每周一凌晨1点执行一次
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { 创建WebSocket客户端 } from '../../工具/WebSocket客户端.js';
import bonProtocol from '../../工具/BON协议.js';
import { 成功日志, 错误日志, 信息日志, 警告日志 } from '../../工具/日志工具.js';
import { 获取账号配置, 任务是否启用 } from '../../工具/任务配置.js';
import { 更新账号状态, 从角色信息提取状态, 更新答题状态 } from '../../工具/账号状态.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const { bon } = bonProtocol;

// 读取tokens
function 读取Tokens() {
  const tokensPath = path.join(__dirname, '../../data/tokens.json');
  return JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
}

// 加载题库
let 题库数据 = null;
function 加载题库() {
  if (题库数据) return 题库数据;
  
  const answerPath = path.join(__dirname, 'answer.json');
  题库数据 = JSON.parse(fs.readFileSync(answerPath, 'utf-8'));
  信息日志(`题库加载成功，共 ${题库数据.length} 道题目`);
  
  return 题库数据;
}

/**
 * 模糊匹配函数 - 查找题目中的关键词
 * @param {string} questionFromDB - 数据库中的题目
 * @param {string} actualQuestion - 实际收到的题目
 * @returns {boolean} - 是否匹配
 */
function 匹配题目(questionFromDB, actualQuestion) {
  if (!questionFromDB || !actualQuestion) return false;
  
  // 去除空格和特殊字符进行匹配
  const cleanDB = questionFromDB.replace(/\s+/g, '').toLowerCase();
  const cleanActual = actualQuestion.replace(/\s+/g, '').toLowerCase();
  
  // 双向包含匹配
  return cleanActual.includes(cleanDB) || cleanDB.includes(cleanActual);
}

/**
 * 查找题目答案
 * @param {string} questionText - 题目文本
 * @returns {number} 答案(1-4)，找不到返回1
 */
function 查找答案(questionText) {
  const questions = 加载题库();
  
  // 遍历题库，查找匹配的题目
  for (let i = 0; i < questions.length; i++) {
    const item = questions[i];
    if (!item.name || !item.value) continue;
    
    if (匹配题目(item.name, questionText)) {
      return item.value;
    }
  }
  
  // 找不到答案，默认返回1
  return 1;
}

/**
 * 提取登录时间
 * @param {object} roleInfo - 角色信息
 * @returns {number|null} - 登录时间戳（秒）
 */
function 提取登录时间(roleInfo) {
  if (!roleInfo || !roleInfo.role) return null;
  
  // 尝试从 statistics 中获取 'last:login:time'
  const stats = roleInfo.role.statistics;
  if (stats && stats['last:login:time']) {
    const time = Number(stats['last:login:time']);
    if (!isNaN(time) && time > 0) {
      return time;
    }
  }
  
  return null;
}

/**
 * 生成随机数种子（与原项目一致）
 * @param {number} lastLoginTime - 登录时间戳（秒）
 * @returns {number} - 随机数种子
 */
function 生成随机数种子(lastLoginTime) {
  const XOR_A = 2118920861;
  const XOR_B = 797788954;
  const XOR_C = 1513922175;
  
  let seed = lastLoginTime | 0;
  seed ^= XOR_A;
  seed = ((seed << 16) | (seed >>> 16)) >>> 0;
  seed ^= XOR_B;
  seed ^= XOR_C;
  return seed >>> 0;
}

/**
 * 判断时间戳是否在本周内
 * @param {number} timestamp - 时间戳（毫秒）
 * @returns {boolean}
 */
function 是否本周(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  
  // 获取本周一0点
  const currentDay = today.getDay(); // 0=周日, 1=周一
  const diff = currentDay === 0 ? 6 : currentDay - 1; // 距离周一的天数
  
  const thisWeekStart = new Date(today);
  thisWeekStart.setDate(today.getDate() - diff);
  thisWeekStart.setHours(0, 0, 0, 0);
  
  // 获取下周一0点
  const nextWeekStart = new Date(thisWeekStart);
  nextWeekStart.setDate(thisWeekStart.getDate() + 7);
  
  return date >= thisWeekStart && date < nextWeekStart;
}

/**
 * 检查答题是否完成（本周已答题）
 * @param {object} roleInfo - 角色信息
 * @returns {boolean}
 */
function 检查答题是否完成(roleInfo) {
  if (!roleInfo || !roleInfo.role || !roleInfo.role.study) {
    return false;
  }
  
  const study = roleInfo.role.study;
  const maxCorrectNum = study.maxCorrectNum || 0;  // 答对题目数
  const beginTime = study.beginTime || 0;          // 答题开始时间（秒）
  
  // 判断条件：答对题目数>=10 且 答题时间在本周内
  if (maxCorrectNum >= 10 && beginTime > 0) {
    const isThisWeek = 是否本周(beginTime * 1000);
    return isThisWeek;
  }
  
  return false;
}

// 执行单个账号的咸鱼大冲关任务
async function 执行咸鱼大冲关(client, accountName) {
  信息日志(`[${accountName}] 开始咸鱼大冲关任务...`);
  
  return new Promise(async (resolve, reject) => {
    try {
      // 先获取角色信息，检查是否已完成
      信息日志(`[${accountName}] 检查答题完成状态...`);
      const roleInfo = await client.获取角色信息();
      
      // 检查是否本周已完成
      if (检查答题是否完成(roleInfo)) {
        const study = roleInfo.role.study;
        const maxCorrectNum = study.maxCorrectNum || 0;
        const beginTime = study.beginTime || 0;
        
        成功日志(`[${accountName}] 本周答题已完成！答对${maxCorrectNum}题`);
        信息日志(`[${accountName}] 答题时间: ${new Date(beginTime * 1000).toLocaleString('zh-CN')}`);
        信息日志(`[${accountName}] 等待下周一重置状态，跳过执行`);
        
        // 更新状态
        更新答题状态(accountName, {
          hasAnswered: true,
          score: maxCorrectNum,
          status: 'completed',
          failReason: null,
          beginTime: beginTime,
          maxCorrectNum: maxCorrectNum
        });
        
        return resolve({ success: true, skipped: true, reason: '本周已完成' });
      }
      
      // 未完成，开始答题
      信息日志(`[${accountName}] 本周答题未完成，开始自动答题...`);
      
      // ===== 关键：同步随机数种子 =====
      信息日志(`[${accountName}] 同步随机数种子...`);
      const lastLoginTime = 提取登录时间(roleInfo);
      if (lastLoginTime) {
        const randomSeed = 生成随机数种子(lastLoginTime);
        信息日志(`[${accountName}] randomSeed = ${randomSeed} (从 lastLoginTime = ${lastLoginTime})`);
        
        // 发送随机数种子
        client.ws.send('system_custom', {
          key: 'randomSeed',
          value: randomSeed
        });
        
        // 等待一下让随机数种子生效
        await new Promise(resolve => setTimeout(resolve, 500));
        成功日志(`[${accountName}] 随机数种子同步完成`);
      } else {
        警告日志(`[${accountName}] 未获取到登录时间，跳过随机数种子同步`);
      }
      
      // 设置40秒超时
      const timeout = setTimeout(async () => {
        错误日志(`[${accountName}] 答题超时`);
        
        // ✅ 关键：超时后重新获取服务器状态
        try {
          信息日志(`[${accountName}] 重新获取服务器状态...`);
          const newRoleInfo = await client.获取角色信息();
          
          // 检查是否已完成
          if (检查答题是否完成(newRoleInfo)) {
            const study = newRoleInfo.role.study;
            const maxCorrectNum = study.maxCorrectNum || 0;
            const beginTime = study.beginTime || 0;
            
            成功日志(`[${accountName}] 超时后检测到已完成10题！`);
            更新答题状态(accountName, {
              hasAnswered: true,
              score: maxCorrectNum,
              status: 'completed',
              failReason: null,
              beginTime: beginTime,
              maxCorrectNum: maxCorrectNum
            });
            
            resolve({ success: true, skipped: true, reason: '超时后检测已完成' });
          } else {
            // 未完成10题，记录超时状态
            const study = newRoleInfo.role?.study;
            const currentScore = study?.maxCorrectNum || 0;
            
            警告日志(`[${accountName}] 答题超时，当前答对${currentScore}题（未完成10题）`);
            更新答题状态(accountName, {
              hasAnswered: false,
              score: currentScore,
              status: 'timeout',
              failReason: `答题超时40秒，当前答对${currentScore}题，未达到10题`,
              beginTime: 0,
              maxCorrectNum: currentScore
            });
            
            resolve({ success: false, error: '答题超时' });
          }
        } catch (error) {
          错误日志(`[${accountName}] 获取服务器状态失败: ${error.message}`);
          // 获取失败，保守处理：清空状态
          更新答题状态(accountName, {
            hasAnswered: false,
            score: 0,
            status: 'timeout',
            failReason: '答题超时40秒，可能服务器未开放答题功能',
            beginTime: 0,
            maxCorrectNum: 0
          });
          
          resolve({ success: false, error: '答题超时' });
        }
      }, 40000);
      
      // 使用通用消息处理器监听答题响应
      const originalHandler = client.ws.messageHandlers.get('message');
      
      const messageHandler = async (message) => {
        try {
          // ===== 检查错误消息 =====
          if (message.error) {
            const errText = String(message.error);
            错误日志(`[${accountName}] 服务器返回错误: ${errText}`);
            
            clearTimeout(timeout);
            client.ws.messageHandlers.set('message', originalHandler);
            
            // 更新状态：服务器错误
            let failReason = errText;
            let status = 'server_error';
            
            // 检查是否是答题次数用完
            if (errText.includes('答题') && errText.includes('次数')) {
              failReason = '今日答题次数已用完（每天3次）';
              status = 'no_attempts';
            }
            
            更新答题状态(accountName, {
              hasAnswered: false,
              score: 0,
              status: status,
              failReason: failReason,
              beginTime: 0,
              maxCorrectNum: 0
            });
            
            return resolve({ success: false, error: errText });
          }
          // ==============================
          
          const cmd = message.cmd?.toLowerCase() || '';
          
          // 检查是否是答题相关响应
          if (!cmd.includes('study') && cmd !== 'studyresp') {
            return; // 不是答题响应，忽略
          }
          
          // 收到答题响应，静默处理
          
          const body = message.body || message;
          
          // 尝试解码body（如果是BON编码）
          let decodedBody = body;
          if (body && typeof body === 'object' && !Array.isArray(body)) {
            const keys = Object.keys(body);
            if (keys.length > 0 && keys.every(key => !isNaN(parseInt(key)))) {
              try {
                const bytes = new Uint8Array(Object.values(body));
                decodedBody = bon.decode(bytes);
                信息日志(`[${accountName}] BON解码成功`);
              } catch (error) {
                警告日志(`[${accountName}] BON解码失败: ${error.message}`);
              }
            }
          }
          
          const questionList = decodedBody.questionList;
          const studyId = decodedBody.role?.study?.id;
          
          if (!questionList || !Array.isArray(questionList)) {
            错误日志(`[${accountName}] 未找到题目列表`);
            clearTimeout(timeout);
            client.ws.messageHandlers.set('message', originalHandler); // 恢复原处理器
            
            // 更新状态：未找到题目
            更新答题状态(accountName, {
              hasAnswered: false,
              score: 0,
              status: 'no_questions',
              failReason: '服务器未返回题目列表，可能答题功能未开放',
              beginTime: 0,
              maxCorrectNum: 0
            });
            
            return resolve({ success: false, error: '未找到题目列表' });
          }
          
          if (!studyId) {
            错误日志(`[${accountName}] 未获取到学习ID`);
            clearTimeout(timeout);
            client.ws.messageHandlers.set('message', originalHandler);
            
            // 更新状态：未获取到ID
            更新答题状态(accountName, {
              hasAnswered: false,
              score: 0,
              status: 'no_study_id',
              failReason: '未获取到学习ID',
              beginTime: 0,
              maxCorrectNum: 0
            });
            
            return resolve({ success: false, error: '未获取到学习ID' });
          }
          
          信息日志(`[${accountName}] 收到 ${questionList.length} 道题目，学习ID: ${studyId}`);
          
          // 恢复原处理器（防止重复处理）
          client.ws.messageHandlers.set('message', originalHandler);
          
          // 遍历题目并回答
          for (let i = 0; i < questionList.length; i++) {
            const question = questionList[i];
            const questionText = question.question;
            const questionId = question.id;
            
            // 查找答案
            const answer = 查找答案(questionText);
            
            信息日志(`[${accountName}] 题目${i + 1}/${questionList.length}: ${questionText.substring(0, 30)}... → 答案:${answer}`);
            
            // 直接发送，不等待响应
            client.ws.send('study_answer', {
              id: studyId,
              option: [answer],
              questionId: [questionId]
            });
            
            // 题目间隔200ms
            if (i < questionList.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 200));
            }
          }
          
          信息日志(`[${accountName}] 所有题目已提交，等待500ms后领取奖励...`);
          await new Promise(resolve => setTimeout(resolve, 500));
          
          // 领取所有等级的奖励 (1-10)
          信息日志(`[${accountName}] 开始领取答题奖励...`);
          for (let rewardId = 1; rewardId <= 10; rewardId++) {
            client.ws.send('study_claimreward', {
              rewardId: rewardId
            });
            await new Promise(resolve => setTimeout(resolve, 200));
          }
          
          信息日志(`[${accountName}] 奖励领取完成，等待1秒后更新状态...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // 获取最新角色信息并更新状态
          try {
            const newRoleInfo = await client.获取角色信息();
            const newStudy = newRoleInfo.role.study;
            const finalScore = newStudy.maxCorrectNum || 0;
            const beginTime = newStudy.beginTime || 0;
            
            // 更新答题状态
            更新答题状态(accountName, {
              hasAnswered: finalScore >= 10,
              score: finalScore,
              status: finalScore >= 10 ? 'completed' : 'partial',
              failReason: finalScore < 10 ? `答对${finalScore}题，未达到10题` : null,
              beginTime: beginTime,
              maxCorrectNum: finalScore
            });
            
            信息日志(`[${accountName}] 账号状态已更新 - 答对${finalScore}题`);
          } catch (error) {
            警告日志(`[${accountName}] 更新账号状态失败: ${error.message}`);
          }
          
          clearTimeout(timeout);
          成功日志(`[${accountName}] 咸鱼大冲关任务完成！`);
          resolve({ success: true });
          
        } catch (error) {
          clearTimeout(timeout);
          错误日志(`[${accountName}] 处理答题响应失败: ${error.message}`);
          client.ws.messageHandlers.set('message', originalHandler);
          resolve({ success: false, error: error.message });
        }
      };
      
      // 注册消息处理器
      client.ws.messageHandlers.set('message', messageHandler);
      
      // 发送开始答题命令（不等待响应）
      信息日志(`[${accountName}] 发送开始答题命令...`);
      client.ws.send('study_startgame', {});
      
    } catch (error) {
      错误日志(`[${accountName}] 咸鱼大冲关任务失败: ${error.message}`);
      resolve({ success: false, error: error.message });
    }
  });
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
  if (!任务是否启用(账号名称, '咸鱼大冲关')) {
    警告日志(`咸鱼大冲关任务未启用，跳过`);
    process.exit(0);
  }
  
  try {
    const client = 创建WebSocket客户端();
    
    // 连接
    await client.连接(tokenData.token);
    成功日志(`连接成功`);
    
    // 等待连接稳定并发送登录认证
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 发送登录命令（获取角色信息）以完成登录
    信息日志(`发送登录认证...`);
    try {
      await client.获取角色信息();
      成功日志(`登录成功`);
    } catch (error) {
      错误日志(`登录失败: ${error.message}`);
      client.断开连接();
      process.exit(1);
    }
    
    // 等待一下让登录状态稳定
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 执行任务
    const result = await 执行咸鱼大冲关(client, 账号名称);
    
    // 等待最后一次命令处理完成
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 断开连接
    client.断开连接();
    
    // ✅ 修复：无论成功或失败，都记录执行时间（避免循环）
    if (result.success) {
      成功日志('执行完成');
      process.exit(0);
    } else {
      警告日志(`执行失败: ${result.error}，但已记录执行时间（避免循环）`);
      // 失败也返回退出码0，让调度器记录执行时间
      process.exit(0);
    }
  } catch (error) {
    错误日志(`执行失败: ${error.message}`);
    // 异常也返回退出码0，让调度器记录执行时间（避免循环）
    警告日志('已记录执行时间（避免循环）');
    process.exit(0);
  }
}

// 全部账号模式（手动执行）
async function 执行全部账号模式() {
  信息日志('============================================================');
  信息日志('        咸鱼大冲关任务 (每周一凌晨1点执行)');
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
    if (!任务是否启用(accountName, '咸鱼大冲关')) {
      警告日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 咸鱼大冲关任务未启用，跳过`);
      continue;
    }
    
    信息日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 正在处理...`);
    
    try {
      const client = 创建WebSocket客户端();
      
      // 连接
      await client.连接(tokenInfo.token);
      成功日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 连接成功`);
      
      // 等待连接稳定并发送登录认证
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 发送登录命令（获取角色信息）以完成登录
      try {
        await client.获取角色信息();
        成功日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 登录成功`);
      } catch (error) {
        错误日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 登录失败: ${error.message}`);
        client.断开连接();
        failedCount++;
        continue;
      }
      
      // 等待一下让登录状态稳定
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // 执行任务
      const result = await 执行咸鱼大冲关(client, accountName);
      
      // 断开连接
      client.断开连接();
      
      if (result.success) {
        if (result.skipped) {
          // ✅ 本周已完成，记为成功但标记为跳过
          successCount++;
        } else {
          successCount++;
        }
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
  成功日志(`咸鱼大冲关任务完成！成功: ${successCount}, 失败: ${failedCount}`);
  信息日志('============================================================');
  
  // ✅ 修复：无论是否跳过，都返回退出码0，让调度器记录执行时间（避免循环）
  // 有账号执行了（无论成功失败或跳过）
  process.exit(0);
}

// 启动
main();
