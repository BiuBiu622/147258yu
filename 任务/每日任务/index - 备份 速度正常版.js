/**
 * 每日任务补差 - 主程序
 * 执行频率: 每天一次
 * 
 * 任务说明:
 * 这是原项目"一键补差"按钮的命令行版本
 * 包含所有每日任务的执行逻辑
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketClient } from '../../工具/WebSocket客户端.js';
import { 成功日志, 错误日志, 警告日志, 信息日志, 清理过期日志 } from '../../工具/日志工具.js';
import { 今天已执行, 账号今天已执行, 开始执行, 完成执行, 清理过期执行记录, 更新账号记录 } from '../../工具/执行记录.js';
import { 获取账号配置, 任务是否启用 } from '../../工具/任务配置.js';
import { 更新账号状态, 获取账号状态, 从角色信息提取状态, 清理过期状态 } from '../../工具/账号状态.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取配置
const 主配置 = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/config.json'), 'utf-8'));
const 任务配置 = JSON.parse(fs.readFileSync(path.join(__dirname, './配置.json'), 'utf-8'));

let client = null;
let currentSeq = 1; // ✅ 全局序列号
const pendingRequests = new Map(); // ✅ seq -> {resolve, reject, timeoutId, cmd}

// ✅ 预先导入BON协议（避免异步导入问题）
import { bon } from '../../工具/BON协议.js';

// 手动购买商品函数
async function 手动购买商品() {
  信息日志('开始手动购买宝箱...');
  
  // 第一轮购买
  await 发送指令('store_buy', { goodsId: 1 }, '购买青铜宝箱', 500);
  await 发送指令('store_buy', { goodsId: 2 }, '购买黄金宝箱', 500);
  await 发送指令('store_buy', { goodsId: 3 }, '购买铂金宝箱', 500);
  
  // 延迟500ms
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // 刷新黑市
  信息日志('刷新黑市商品列表...');
  await 发送指令('store_refresh', { storeId: 1 }, '刷新黑市', 500);
  
  // 延迟500ms
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // 第二轮购买
  await 发送指令('store_buy', { goodsId: 1 }, '购买青铜宝箱', 500);
  await 发送指令('store_buy', { goodsId: 2 }, '购买黄金宝箱', 500);
  await 发送指令('store_buy', { goodsId: 3 }, '购买铂金宝箱', 500);
  
  信息日志('手动购买完成（青铜+黄金+铂金各2个）');
}

// 工具函数: 检查今天是否可用
function 今天可用(时间戳) {
  if (!时间戳) return true;
  const now = new Date();
  const lastTime = new Date(时间戳);
  return now.toDateString() !== lastTime.toDateString();
}

// ⚠️ 注意：BOSS战斗已移至独立的"BOSS战斗"任务模块
// 此函数已废弃，保留仅为兼容性
// 工具函数: 获取今日BOSS ID（已废弃）
function 获取今日BOSSID() {
  // 周日=9904, 周一=9905, 周二=9901, 周三=9902, 周四=9903, 周五=9904, 周六=9905
  const DAY_BOSS_MAP = [9904, 9905, 9901, 9902, 9903, 9904, 9905];
  const dayOfWeek = new Date().getDay();
  return DAY_BOSS_MAP[dayOfWeek];
}

// ✅ 全局消息监听器（统一处理所有响应）
function 初始化消息监听器() {
  // 避免重复添加监听器
  client.removeAllListeners('message');
  
  client.on('message', (message) => {
    const ack = message.ack;
    
    // 根据ack精准匹配请求
    if (ack && pendingRequests.has(ack)) {
      const pending = pendingRequests.get(ack);
      clearTimeout(pending.timeoutId);
      pendingRequests.delete(ack);
      pending.resolve(message);
    }
  });
}

// ✅ 工具函数: 发送游戏指令（使用seq/ack精准匹配）
async function 发送指令(cmd, body = {}, 描述 = '', 超时时间 = 3000) {
  const seq = currentSeq++;
  const 显示描述 = 描述 || cmd;
  
  信息日志(`[SEQ ${seq}] 执行: ${显示描述}`);
  
  return new Promise((resolve, reject) => {
    // 设置超时
    const timeoutId = setTimeout(() => {
      if (pendingRequests.has(seq)) {
        pendingRequests.delete(seq);
        警告日志(`[SEQ ${seq}] 超时: ${显示描述}`);
        resolve(null); // 超时返回null
      }
    }, 超时时间);
    
    // 注册到待处理队列
    pendingRequests.set(seq, {
      resolve,
      reject,
      timeoutId,
      cmd,
      描述: 显示描述
    });
    
    // 发送命令（带seq）
    client.send(cmd, { ...body, seq });
  });
}

// 工具函数: 智能切换阵容
async function 切换阵容(目标阵容, 描述) {
  try {
    信息日志(`${描述}: 切换到阵容${目标阵容}`);
    await 发送指令('role_switchformation', { formationId: 目标阵容 }, `切换到${描述}`, 1000);
  } catch (error) {
    警告日志(`阵容切换失败: ${error.message}`);
  }
}

// 任务执行器
async function 执行每日任务(角色信息, 账号前缀 = '', 账号名称 = '') {
  const prefix = 账号前缀 ? `${账号前缀} ` : '';
  
  信息日志('');
  信息日志(`${prefix}=== 开始执行每日任务补差 ===`);
  信息日志('');
  
  // 不再检查已完成任务状态，直接执行所有任务，服务器会自动处理重复请求
  
  // 读取账号配置
  let 设置;
  if (账号名称) {
    const 账号任务配置 = 获取账号配置(账号名称, '每日任务');
    设置 = 账号任务配置 || 任务配置.设置;
    信息日志(`${prefix}使用配置: ${账号任务配置 ? '账号配置' : '默认配置'}`);
  } else {
    设置 = 任务配置.设置;
    信息日志(`${prefix}使用默认配置`);
  }
  let 任务计数 = 0;
  
  // ===== 1. 固定奖励领取 =====
  信息日志('[1/6] 固定奖励领取');
  
  // seq 1: 珍宝阁领取
  await 发送指令('collection_claimfreereward', {}, '珍宝阁领取', 1000);
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // seq 2: 签到奖励领取
  await 发送指令('system_signinreward', {}, '签到奖励领取', 1000);
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // seq 3: 尊享特权-福利卡-领取
  await 发送指令('card_claimreward', { cardId: 1 }, '福利卡领取(cardId:1)', 1000);
  await new Promise(resolve => setTimeout(resolve, 500));
  await 发送指令('card_claimreward', {}, '福利卡领取(默认)', 1000);
  await new Promise(resolve => setTimeout(resolve, 500));
  await 发送指令('card_claimreward', { cardId: 4003 }, '永久卡领取', 1000);
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // ⚠️ 俱乐部签到已移除，由独立的"俱乐部签到"任务执行（优先级6）
  // 原因：避免重复执行，独立任务可以单独控制开关
  // await 发送指令('legion_signin', {}, '俱乐部签到', 1000);
  // await new Promise(resolve => setTimeout(resolve, 500));
  
  // 每日礼包领取（seq 35 在抓包数据中，但放在固定奖励部分）
  await 发送指令('discount_claimreward', { discountId: 1 }, '每日礼包领取', 1000);
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // 领取邮件（可选）
  if (设置.领取邮件 === true) {
    await 发送指令('mail_claimallattachment', {}, '领取邮件奖励', 1000);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  成功日志('固定奖励领取完成');
  信息日志('');
  
  // ===== 2. 挂机奖励 =====
  信息日志('[2/6] 挂机奖励');
  
  if (设置.领取挂机奖励 === true) {
    // seq 4: 先领取挂机奖励
    await 发送指令('system_claimhangupreward', {}, '领取挂机奖励', 1000);
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // seq 5-8: 加钟4次（type: 2 表示挂机加钟）
    for (let i = 1; i <= 4; i++) {
      await 发送指令('system_mysharecallback', { isSkipShareCard: false, type: 2 }, `挂机加钟 ${i}/4`, 1000);
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    任务计数++;
    成功日志('挂机奖励领取完成');
  } else {
    信息日志('跳过: 挂机奖励（未启用）');
  }
  信息日志('');
  
  // ===== 3. 基础任务 =====
  信息日志('[3/6] 基础任务');
  
  // seq 9: 分享游戏（type: 3 表示分享游戏，注意与加钟的type: 2区分）
  await 发送指令('system_mysharecallback', { isSkipShareCard: false, type: 3 }, '分享游戏', 1000);
  await new Promise(resolve => setTimeout(resolve, 500));
  任务计数++;
  
  // seq 10: 赠送好友金币
  await 发送指令('friend_batch', { friendId: 0 }, '赠送好友金币', 1000);
  await new Promise(resolve => setTimeout(resolve, 500));
  任务计数++;
  
  // seq 11-13: 点金3次（直接执行，服务器会处理重复请求）
  for (let i = 1; i <= 3; i++) {
    await 发送指令('system_buygold', { buyNum: 1 }, `免费点金 ${i}/3`, 1000);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  任务计数++;
  
  // seq 14: 开启木质宝箱x10
  if (设置.开启宝箱 === true) {
    await 发送指令('item_openbox', { itemId: 2001, number: 10 }, '开启木质宝箱x10', 1000);
    await new Promise(resolve => setTimeout(resolve, 500));
    任务计数++;
  }
  
  // 盐罐（不在抓包中，但保留）
  if (设置.领取盐罐 === true) {
    await 发送指令('bottlehelper_claim', {}, '领取盐罐奖励', 1000);
    await new Promise(resolve => setTimeout(resolve, 500));
    任务计数++;
  }
  
  // seq 16-17: 招募
  // seq 16: 免费招募（recruitType: 3）
  await 发送指令('hero_recruit', { byClub: false, recruitNumber: 1, recruitType: 3 }, '免费招募', 1000);
  await new Promise(resolve => setTimeout(resolve, 500));
  任务计数++;
  
  // seq 17: 付费招募（recruitType: 1）
  if (设置.付费招募 === true) {
    await 发送指令('hero_recruit', { byClub: false, recruitNumber: 1, recruitType: 1 }, '付费招募', 1000);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  成功日志(`基础任务完成: ${任务计数}个`);
  信息日志('');
  
  // ===== 4. 免费活动 =====
  信息日志('[4/6] 免费活动');
  
  // 免费钓鱼3次（直接执行，服务器会处理重复请求）
  for (let i = 1; i <= 3; i++) {
    await 发送指令('artifact_lottery', { lotteryNumber: 1, newFree: true, type: 1 }, `免费钓鱼 ${i}/3`, 1000);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  成功日志('免费活动完成');
  信息日志('');
  
  // ===== 5. 黑市购买（任务ID: 12）=====
  信息日志('[5/6] 黑市购买');
  
  if (设置.黑市购买 === true) {
    // seq 38: 一键购买（需要等待4秒才有body回应）
    if (设置.购买清单 === true) {
      信息日志('执行一键购买（等待4秒）...');
      const 清单购买响应 = await 发送指令('store_purchase', {}, '黑市一键购买', 4000);
      
      // ===== 解析响应并判断购买是否成功（通用判断，不依赖特定商品ID）=====
      let 购买成功 = false;
      let 解码后的body = null;
      let 判断原因 = '';
      
      if (清单购买响应) {
        // 检查是否有错误
        if (清单购买响应.error) {
          警告日志(`服务器返回错误: ${清单购买响应.error}`);
          判断原因 = `服务器返回错误: ${清单购买响应.error}`;
        } else if (清单购买响应.body) {
          // 解析 body（支持 BON 编码和已解码对象）
          if (清单购买响应.body instanceof Uint8Array) {
            // body 是 BON 编码，需要解码
            try {
              解码后的body = bon.decode(清单购买响应.body);
            } catch (decodeError) {
              错误日志(`BON 解码失败: ${decodeError.message}`);
              判断原因 = `BON 解码失败: ${decodeError.message}`;
            }
          } else if (typeof 清单购买响应.body === 'object' && 清单购买响应.body !== null) {
            // body 已经是对象
            解码后的body = 清单购买响应.body;
          }
          
          // 判断购买是否成功（通用判断，适用于任何购买清单配置）
          if (解码后的body) {
            // 方法1: 检查 goodsList 中是否有任何商品的 buy_quantity > 0
            // 这是最可靠的判断方法，适用于所有账号和购买清单配置
            if (解码后的body.goodsList && typeof 解码后的body.goodsList === 'object') {
              const 商品列表 = 解码后的body.goodsList;
              let 已购买商品数 = 0;
              let 已购买商品详情 = [];
              
              // 遍历所有商品，不依赖特定商品ID
              for (const [goodsId, goodsInfo] of Object.entries(商品列表)) {
                // 检查 buy_quantity 是否存在且大于 0
                if (goodsInfo && typeof goodsInfo === 'object' && goodsInfo.buy_quantity > 0) {
                  已购买商品数++;
                  const 折扣信息 = goodsInfo.discount ? `折扣:${goodsInfo.discount}` : '';
                  已购买商品详情.push(`商品${goodsId}(数量:${goodsInfo.buy_quantity}${折扣信息 ? `, ${折扣信息}` : ''})`);
                }
              }
              
              if (已购买商品数 > 0) {
                购买成功 = true;
                判断原因 = `已购买 ${已购买商品数} 个商品: ${已购买商品详情.join(', ')}`;
                信息日志(`✅ ${判断原因}`);
              } else {
                判断原因 = 'goodsList 中所有商品的 buy_quantity 都为 0，没有商品被购买';
                信息日志(`⚠️  ${判断原因}`);
              }
            }
            
            // 方法2: 检查 reward 数组是否不为空（作为备用判断）
            // 如果 reward 数组有内容，说明获得了奖励，购买肯定成功了
            if (!购买成功 && 解码后的body.reward && Array.isArray(解码后的body.reward) && 解码后的body.reward.length > 0) {
              购买成功 = true;
              判断原因 = `获得 ${解码后的body.reward.length} 个奖励`;
              信息日志(`✅ ${判断原因}`);
            }
            
            // 方法3: 如果 body 存在但没有 goodsList 和 reward，可能是异常情况
            if (!购买成功) {
              if (解码后的body.role) {
                判断原因 = '服务器已处理购买请求，但 goodsList 中所有商品的 buy_quantity 都为 0，且没有 reward';
                信息日志(`⚠️  ${判断原因}`);
              } else {
                判断原因 = '响应 body 存在，但缺少 goodsList 和 reward 字段';
                信息日志(`⚠️  ${判断原因}`);
              }
            }
          } else {
            判断原因 = 'body 解析失败或为空';
            信息日志(`⚠️  ${判断原因}`);
          }
        } else {
          判断原因 = '响应中没有 body 字段';
          信息日志(`⚠️  ${判断原因}`);
        }
      } else {
        判断原因 = '响应为 null 或 undefined（可能超时）';
        信息日志(`⚠️  ${判断原因}`);
      }
      
      // 根据判断结果执行相应操作
      if (购买成功) {
        成功日志(`黑市一键购买成功（${判断原因}）`);
      } else {
        // 无响应、解码失败或没有商品被购买 → 执行手动购买
        警告日志(`一键购买失败: ${判断原因}`);
        if (设置.手动购买 === true) {
          信息日志('切换到手动购买...');
          await 手动购买商品();
        }
      }
    } else if (设置.手动购买 === true) {
      // 不使用一键购买，直接手动购买
      信息日志('执行手动购买...');
      await 手动购买商品();
    } else {
      警告日志('一键购买和手动购买均未启用');
    }
  } else {
    信息日志('跳过: 黑市购买（未启用或已完成）');
  }
  信息日志('');
  
  // ===== 6. 任务奖励领取 =====
  信息日志('[6/6] 任务奖励领取');
  
  // seq 62: 领取每日任务单项积分（1-10，修复BUG：应该到12）
  for (let taskId = 1; taskId <= 12; taskId++) {
    await 发送指令('task_claimdailypoint', { taskId }, `领取任务${taskId}积分`, 1000);
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  
  // seq 63: 领取日活跃奖励（全部领取，rewardId: 0）
  await 发送指令('task_claimdailyreward', { rewardId: 0 }, '领取日活跃奖励', 1000);
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // seq 66: 领取周活跃奖励（全部领取，rewardId: 0）
  await 发送指令('task_claimweekreward', { rewardId: 0 }, '领取周活跃奖励', 1000);
  await new Promise(resolve => setTimeout(resolve, 500));
  
  成功日志('任务奖励领取完成');
  信息日志('');
  
  信息日志('');
  成功日志(`${prefix}=== 每日任务补差执行完成 ===`);
  信息日志('');

  // 注意：不再在这里获取进度，进度将在执行单个账号函数中统一获取和保存
  return 0; // 不再返回进度，进度将在后续步骤中获取
}

// 单个账号执行函数
async function 执行单个账号(tokenData, 账号索引, 总账号数) {
  const 账号前缀 = `[账号${账号索引 + 1}/${总账号数}: ${tokenData.name}]`;
  const 开始时间 = Date.now();
  let 最终进度 = 0;
  
  try {
    信息日志(`${账号前缀} 正在连接...`);
    
    const actualToken = tokenData.token;
    client = new WebSocketClient(主配置.wsServer, actualToken);
    
    // 连接
    await client.connect();
    成功日志(`${账号前缀} 连接成功！`);
    
    // ✅ 初始化全局消息监听器（避免并发冲突）
    初始化消息监听器();
    
    // 等待1秒后发送初始化命令
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 发送获取数据版本
    await new Promise(resolve => setTimeout(resolve, 100));
    await 发送指令('system_getdatabundlever', { isAudit: false }, `${账号前缀} 获取数据版本`, 1000);
    
    // 等待1秒后开始检查进度
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // ===== 步骤1：先检查当前进度（避免重复执行已完成的任务）=====
    信息日志(`${账号前缀} 检查当前任务进度...`);
    
    let 进度获取成功 = false;
    let 服务器进度 = 0;
    let 重试次数 = 0;
    const 最大重试次数 = 3;
    let 初始角色数据 = null;
    
    // 获取初始进度（用于判断是否需要执行任务）
    while (!进度获取成功 && 重试次数 < 最大重试次数) {
      try {
        重试次数++;
        if (重试次数 > 1) {
          信息日志(`${账号前缀} 第 ${重试次数} 次尝试获取初始进度...`);
        }
        
        // ===== 检查WebSocket连接状态，如果断开则重连 =====
        if (!client || !client.ws || client.ws.readyState !== 1) {
          警告日志(`${账号前缀} WebSocket连接已断开，正在重新连接...`);
          
          try {
            // 清理旧连接
            if (client) {
              try {
                client.disconnect();
              } catch (e) {
                // 忽略断开连接错误
              }
            }
            
            // 重新建立连接
            client = new WebSocketClient(主配置.wsServer, actualToken);
            await client.connect();
            
            // 重新初始化消息监听器
            初始化消息监听器();
            
            成功日志(`${账号前缀} 重新连接成功`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (reconnectError) {
            错误日志(`${账号前缀} 重新连接失败: ${reconnectError.message}`);
            // 继续重试
            if (重试次数 < 最大重试次数) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
            continue;
          }
        }
        
        // 发送获取角色信息指令
        const 初始角色信息 = await 发送指令('role_getroleinfo', {
          clientVersion: '1.65.3-wx',
          inviteUid: 0,
          platform: 'hortor',
          platformExt: 'mix',
          scene: ''
        }, `${账号前缀} 获取初始进度`, 5000);
        
        if (!初始角色信息 || !初始角色信息.body) {
          警告日志(`${账号前缀} 服务器未返回角色信息`);
          if (重试次数 < 最大重试次数) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          continue;
        }
        
        // 解析body
        let 初始数据 = 初始角色信息.body;
        if (初始数据 instanceof Uint8Array) {
          const { bon } = await import('../../工具/BON协议.js');
          初始数据 = bon.decode(初始数据);
          if (!初始数据) {
            错误日志(`${账号前缀} BON解码失败`);
            if (重试次数 < 最大重试次数) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
            continue;
          }
        }
        
        // 提取服务器返回的进度值
        if (!初始数据?.role?.dailyTask) {
          错误日志(`${账号前缀} 角色数据中缺少 dailyTask 字段`);
          if (重试次数 < 最大重试次数) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          continue;
        }
        
        服务器进度 = 初始数据.role.dailyTask.dailyPoint || 0;
        信息日志(`${账号前缀} 服务器返回初始进度: ${服务器进度}/110`);
        
        // 保存初始角色数据，供后续使用
        初始角色数据 = 初始数据;
        
        // 提取并保存状态（只提取每日任务、挂机、盐罐相关数据，不影响其他任务）
        const 状态数据 = 从角色信息提取状态(初始数据, ['dailyTask', 'hangUp', 'bottleHelper']);
        if (!状态数据) {
          错误日志(`${账号前缀} 提取状态数据失败，角色数据为空`);
          if (重试次数 < 最大重试次数) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          continue;
        }
        
        // 保存状态到本地（只更新每日任务、挂机、盐罐数据）
        更新账号状态(tokenData.name, 状态数据);
        
        // 验证保存是否成功
        const 本地状态 = 获取账号状态(tokenData.name);
        const 本地进度 = 本地状态?.dailyTask?.dailyPoint || 0;
        
        if (本地进度 === 服务器进度) {
          成功日志(`${账号前缀} ✅ 初始进度获取成功：服务器=${服务器进度}/110，本地=${本地进度}/110（一致）`);
          进度获取成功 = true;
          最终进度 = 服务器进度;
        } else {
          错误日志(`${账号前缀} ❌ 初始进度保存失败：服务器=${服务器进度}/110，本地=${本地进度}/110（不一致）`);
          // 继续重试
          if (重试次数 < 最大重试次数) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        
      } catch (error) {
        错误日志(`${账号前缀} 获取初始进度异常（第${重试次数}次）: ${error.message}`);
        if (重试次数 < 最大重试次数) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    // ===== 步骤2：判断是否需要执行任务 =====
    const 成功阈值 = 70;
    const 初始真实进度 = 进度获取成功 ? 服务器进度 : 0;
    
    // 如果进度>=70但保存失败，继续重试保存（最多3次），不需要执行任务
    if (!进度获取成功 && 初始真实进度 >= 成功阈值) {
      警告日志(`${账号前缀} ⚠️  进度>=70但数据保存失败，继续重试保存（最多3次）`);
      信息日志(`${账号前缀} 任务已完成，只需保存数据到本地`);
      
      // 继续重试保存（最多3次）
      let 保存重试次数 = 0;
      const 最大保存重试次数 = 3;
      
      while (!进度获取成功 && 保存重试次数 < 最大保存重试次数) {
        保存重试次数++;
        信息日志(`${账号前缀} 第 ${保存重试次数} 次尝试保存数据...`);
        
        try {
          // 检查WebSocket连接状态
          if (!client || !client.ws || client.ws.readyState !== 1) {
            警告日志(`${账号前缀} WebSocket连接已断开，正在重新连接...`);
            try {
              if (client) {
                try {
                  client.disconnect();
                } catch (e) {
                  // 忽略断开连接错误
                }
              }
              client = new WebSocketClient(主配置.wsServer, actualToken);
              await client.connect();
              初始化消息监听器();
              成功日志(`${账号前缀} 重新连接成功`);
              await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (reconnectError) {
              错误日志(`${账号前缀} 重新连接失败: ${reconnectError.message}`);
              if (保存重试次数 < 最大保存重试次数) {
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
              continue;
            }
          }
          
          // 使用之前获取的初始角色数据重新保存
          if (初始角色数据) {
            // 提取并保存状态
            const 状态数据 = 从角色信息提取状态(初始角色数据, ['dailyTask', 'hangUp', 'bottleHelper']);
            if (状态数据) {
              更新账号状态(tokenData.name, 状态数据);
              
              // 验证保存是否成功
              const 本地状态 = 获取账号状态(tokenData.name);
              const 本地进度 = 本地状态?.dailyTask?.dailyPoint || 0;
              
              if (本地进度 === 服务器进度) {
                成功日志(`${账号前缀} ✅ 数据保存成功：服务器=${服务器进度}/110，本地=${本地进度}/110（一致）`);
                进度获取成功 = true;
                最终进度 = 服务器进度;
                break; // 保存成功，退出循环
              } else {
                错误日志(`${账号前缀} ❌ 数据保存失败：服务器=${服务器进度}/110，本地=${本地进度}/110（不一致）`);
              }
            }
          } else {
            // 如果没有初始数据，重新获取
            信息日志(`${账号前缀} 重新获取角色信息...`);
            const 重新获取角色信息 = await 发送指令('role_getroleinfo', {
              clientVersion: '1.65.3-wx',
              inviteUid: 0,
              platform: 'hortor',
              platformExt: 'mix',
              scene: ''
            }, `${账号前缀} 重新获取角色信息`, 5000);
            
            if (重新获取角色信息 && 重新获取角色信息.body) {
              let 重新获取数据 = 重新获取角色信息.body;
              if (重新获取数据 instanceof Uint8Array) {
                const { bon } = await import('../../工具/BON协议.js');
                重新获取数据 = bon.decode(重新获取数据);
              }
              
              if (重新获取数据?.role?.dailyTask) {
                服务器进度 = 重新获取数据.role.dailyTask.dailyPoint || 0;
                初始角色数据 = 重新获取数据;
                
                // 提取并保存状态
                const 状态数据 = 从角色信息提取状态(重新获取数据, ['dailyTask', 'hangUp', 'bottleHelper']);
                if (状态数据) {
                  更新账号状态(tokenData.name, 状态数据);
                  
                  // 验证保存是否成功
                  const 本地状态 = 获取账号状态(tokenData.name);
                  const 本地进度 = 本地状态?.dailyTask?.dailyPoint || 0;
                  
                  if (本地进度 === 服务器进度) {
                    成功日志(`${账号前缀} ✅ 数据保存成功：服务器=${服务器进度}/110，本地=${本地进度}/110（一致）`);
                    进度获取成功 = true;
                    最终进度 = 服务器进度;
                    break; // 保存成功，退出循环
                  } else {
                    错误日志(`${账号前缀} ❌ 数据保存失败：服务器=${服务器进度}/110，本地=${本地进度}/110（不一致）`);
                  }
                }
              }
            }
          }
          
          // 如果还没成功，等待1秒后重试
          if (!进度获取成功 && 保存重试次数 < 最大保存重试次数) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          
        } catch (error) {
          错误日志(`${账号前缀} 保存数据异常（第${保存重试次数}次）: ${error.message}`);
          if (保存重试次数 < 最大保存重试次数) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
    }
    
    // 如果进度>=70 且 保存成功（本地和服务器一致），直接跳过任务执行
    if (进度获取成功 && 初始真实进度 >= 成功阈值) {
      成功日志(`${账号前缀} ✅ 任务已完成：进度 ${初始真实进度}/110 >= ${成功阈值}，跳过执行`);
      成功日志(`${账号前缀} ✅ 数据保存成功：服务器=${服务器进度}/110，本地=${初始真实进度}/110（一致）`);
      
      // 关闭连接
      client.disconnect();
      
      const 执行时长 = Math.round((Date.now() - 开始时间) / 1000);
      成功日志(`${账号前缀} ✅ 任务已完成（跳过执行）：进度 ${初始真实进度}/110 >= ${成功阈值} (耗时: ${执行时长}秒)`);
      信息日志('');
      
      return { 
        success: true, 
        name: tokenData.name,
        startProgress: 初始真实进度,
        endProgress: 初始真实进度,
        duration: `${执行时长}秒`,
        progressFetchFailed: false,
        skipped: true  // 标记为跳过执行
      };
    }
    
    // 如果进度>=70但保存一直失败（3次都失败），作为兜底继续执行任务
    if (!进度获取成功 && 初始真实进度 >= 成功阈值) {
      警告日志(`${账号前缀} ⚠️  进度>=70但数据保存失败（已重试3次），继续执行任务作为兜底`);
    }
    
    // 如果进度获取失败，也继续执行任务（可能是网络问题，但任务可能未完成）
    if (!进度获取成功) {
      警告日志(`${账号前缀} ⚠️  初始进度获取失败，已重试 ${最大重试次数} 次`);
      警告日志(`${账号前缀} 将继续执行任务以确保完成`);
    }
    
    // ===== 步骤3：执行每日任务（进度<70或获取失败时）=====
    信息日志(`${账号前缀} 开始执行每日任务...`);
    if (进度获取成功) {
      信息日志(`${账号前缀} 当前进度: ${初始真实进度}/110 < ${成功阈值}，需要执行任务`);
    } else {
      信息日志(`${账号前缀} 进度获取失败，执行任务以确保完成`);
    }
    
    // 执行每日任务（每个子任务延迟500毫秒，WebSocket客户端会自动保持心跳）
    await 执行每日任务(null, 账号前缀, tokenData.name);
    
    // ===== 步骤4：延迟500毫秒 =====
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // ===== 步骤5：获取任务进度并保存到本地 =====
    信息日志(`${账号前缀} 获取任务进度...`);
    
    // 重置重试计数
    进度获取成功 = false;
    服务器进度 = 0;
    重试次数 = 0;
    
    while (!进度获取成功 && 重试次数 < 最大重试次数) {
      try {
        重试次数++;
        if (重试次数 > 1) {
          信息日志(`${账号前缀} 第 ${重试次数} 次尝试获取进度...`);
        }
        
        // ===== 检查WebSocket连接状态，如果断开则重连 =====
        if (!client || !client.ws || client.ws.readyState !== 1) {
          警告日志(`${账号前缀} WebSocket连接已断开，正在重新连接...`);
          
          try {
            // 清理旧连接
            if (client) {
              try {
                client.disconnect();
              } catch (e) {
                // 忽略断开连接错误
              }
            }
            
            // 重新建立连接
            client = new WebSocketClient(主配置.wsServer, actualToken);
            await client.connect();
            
            // 重新初始化消息监听器
            初始化消息监听器();
            
            成功日志(`${账号前缀} 重新连接成功`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (reconnectError) {
            错误日志(`${账号前缀} 重新连接失败: ${reconnectError.message}`);
            // 继续重试
            if (重试次数 < 最大重试次数) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
            continue;
          }
        }
        
        // 发送获取角色信息指令
        const 最终角色信息 = await 发送指令('role_getroleinfo', {
          clientVersion: '1.65.3-wx',
          inviteUid: 0,
          platform: 'hortor',
          platformExt: 'mix',
          scene: ''
        }, `${账号前缀} 获取任务进度`, 5000);
        
        if (!最终角色信息 || !最终角色信息.body) {
          警告日志(`${账号前缀} 服务器未返回角色信息`);
          if (重试次数 < 最大重试次数) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          continue;
        }
        
        // 解析body
        let 最终数据 = 最终角色信息.body;
        if (最终数据 instanceof Uint8Array) {
          const { bon } = await import('../../工具/BON协议.js');
          最终数据 = bon.decode(最终数据);
          if (!最终数据) {
            错误日志(`${账号前缀} BON解码失败`);
            if (重试次数 < 最大重试次数) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
            continue;
          }
        }
        
        // 提取服务器返回的进度值
        if (!最终数据?.role?.dailyTask) {
          错误日志(`${账号前缀} 角色数据中缺少 dailyTask 字段`);
          if (重试次数 < 最大重试次数) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          continue;
        }
        
        服务器进度 = 最终数据.role.dailyTask.dailyPoint || 0;
        信息日志(`${账号前缀} 服务器返回进度: ${服务器进度}/110`);
        
        // 提取并保存状态（只提取每日任务、挂机、盐罐相关数据，不影响其他任务）
        const 状态数据 = 从角色信息提取状态(最终数据, ['dailyTask', 'hangUp', 'bottleHelper']);
        if (!状态数据) {
          错误日志(`${账号前缀} 提取状态数据失败，角色数据为空`);
          if (重试次数 < 最大重试次数) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          continue;
        }
        
        // 保存状态到本地（只更新每日任务、挂机、盐罐数据）
        更新账号状态(tokenData.name, 状态数据);
        
        // 验证保存是否成功
        const 本地状态 = 获取账号状态(tokenData.name);
        const 本地进度 = 本地状态?.dailyTask?.dailyPoint || 0;
        
        if (本地进度 === 服务器进度) {
          成功日志(`${账号前缀} ✅ 进度获取成功：服务器=${服务器进度}/110，本地=${本地进度}/110（一致）`);
          进度获取成功 = true;
          最终进度 = 服务器进度;
        } else {
          错误日志(`${账号前缀} ❌ 进度保存失败：服务器=${服务器进度}/110，本地=${本地进度}/110（不一致）`);
          // 继续重试
          if (重试次数 < 最大重试次数) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
        
      } catch (error) {
        错误日志(`${账号前缀} 获取进度异常（第${重试次数}次）: ${error.message}`);
        if (重试次数 < 最大重试次数) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    // ===== 判断进度获取是否成功 =====
    // 注意：分数获取要么失败要么成功，跟任务没关系
    // 如果获取失败，不影响任务状态，任务可能已经完成了
    if (!进度获取成功) {
      警告日志(`${账号前缀} ⚠️  进度获取失败，已重试 ${最大重试次数} 次`);
      警告日志(`${账号前缀} 可能是网络问题，但任务可能已经完成`);
      // 使用服务器返回的进度值（如果有的话），否则使用初始进度
      最终进度 = 服务器进度 || 初始真实进度 || 0;
    }
    
    // 关闭连接
    client.disconnect();
    
    // ===== 步骤6：判断任务成功/失败 =====
    // 注意：只有获取到进度且<70分才算任务失败，需要重新做任务
    // 如果进度获取失败，不影响任务状态，任务可能已经完成了
    const 最终状态 = 获取账号状态(tokenData.name);
    const 最终真实进度 = 最终状态?.dailyTask?.dailyPoint || 最终进度;
    
    const 执行时长 = Math.round((Date.now() - 开始时间) / 1000);
    
    // 情况1：进度获取成功且进度>=70分 -> 任务成功
    if (进度获取成功 && 最终真实进度 >= 成功阈值) {
      成功日志(`${账号前缀} ✅ 任务执行成功：进度 ${最终真实进度}/110 >= ${成功阈值} (耗时: ${执行时长}秒)`);
      信息日志('');
      return { 
        success: true, 
        name: tokenData.name,
        startProgress: 初始真实进度,
        endProgress: 最终真实进度,
        duration: `${执行时长}秒`,
        progressFetchFailed: false
      };
    }
    
    // 情况2：进度获取成功但进度<70分 -> 任务失败，需要重新做任务
    if (进度获取成功 && 最终真实进度 < 成功阈值) {
      错误日志(`${账号前缀} ❌ 任务执行失败：进度 ${最终真实进度}/110 < ${成功阈值} (耗时: ${执行时长}秒)`);
      错误日志(`${账号前缀} 调度器将在下次检测时重试（一天最多3次）`);
      信息日志('');
      return { 
        success: false, 
        name: tokenData.name,
        error: `进度未达标: ${最终真实进度}/110 < ${成功阈值}`,
        startProgress: 初始真实进度,
        endProgress: 最终真实进度,
        duration: `${执行时长}秒`,
        progressFetchFailed: false
      };
    }
    
    // 情况3：进度获取失败 -> 不影响任务状态，假设任务已完成
    // 注意：分数获取要么失败要么成功，跟任务没关系。任务失败了也会获取到分数0的
    // 如果获取失败，可能是网络问题，但任务可能已经完成了，不应该重新做任务
    if (!进度获取成功) {
      警告日志(`${账号前缀} ⚠️  进度获取失败，但任务可能已经完成`);
      警告日志(`${账号前缀} 当前进度: ${最终真实进度}/110（可能不准确）`);
      警告日志(`${账号前缀} 任务已执行，假设已完成（不重新做任务）`);
      信息日志('');
      return { 
        success: true,  // 假设任务已完成，不重新做任务
        name: tokenData.name,
        startProgress: 初始真实进度,
        endProgress: 最终真实进度,
        duration: `${执行时长}秒`,
        progressFetchFailed: true  // 标记进度获取失败，但不影响任务状态
      };
    }
  } catch (error) {
    错误日志(`${账号前缀} 执行失败: ${error.message}`);
    if (client) {
      client.disconnect();
    }
    const 执行时长 = Math.round((Date.now() - 开始时间) / 1000);
    return { 
      success: false, 
      name: tokenData.name, 
      error: error.message,
      startProgress: 0, // 每日清理后起始进度为0
      endProgress: 最终进度,
      duration: `${执行时长}秒`
    };
  }
}

// 主函数
async function main() {
  try {
    // 检查是否有强制执行参数
    const 强制执行 = process.argv.includes('--force') || process.argv.includes('-f');
    
    // 检查是否有指定账号参数
    const accountIndex = process.argv.indexOf('--account');
    const 指定账号 = accountIndex !== -1 ? process.argv[accountIndex + 1] : null;
    
    // 检查执行模式参数
    const modeIndex = process.argv.indexOf('--mode');
    const 执行模式 = modeIndex !== -1 ? process.argv[modeIndex + 1] : 'full';
    
    if (指定账号) {
      // 单账号模式（由调度器调用）
      await 执行单个账号模式(指定账号, 执行模式);
    } else {
      // 全部账号模式（手动执行或强制执行）
      await 执行全部账号模式(强制执行);
    }
  } catch (error) {
    错误日志('执行失败:', error.message);
    console.error(error);
    process.exit(1);
  }
}

// 单账号模式（由调度器调用）
async function 执行单个账号模式(账号名称, 执行模式 = 'full') {
  信息日志(`======== 单账号模式: ${账号名称} (模式: ${执行模式}) ========`);
  
  // 读取tokens
  const tokensFile = path.join(__dirname, '../../', 主配置.tokensFile);
  const tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf-8'));
  
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
  if (!任务是否启用(账号名称, '每日任务')) {
    警告日志(`每日任务未启用，跳过`);
    process.exit(0);
  }
  
  // ✅ 执行任务（修复BUG: 删除多余的执行模式参数）
  const result = await 执行单个账号(tokenData, 0, 1);
  
  // 保存账号记录
  更新账号记录(result.name, {
    status: result.success ? 'success' : 'failed',
    error: result.error || null,
    startProgress: result.startProgress || 0,
    endProgress: result.endProgress || 0,
    duration: result.duration || '0秒'
  });
  
  // 如果进度获取失败，更新任务记录（供调度器检测）
  if (result.progressFetchFailed) {
    try {
      const 任务记录文件 = path.join(__dirname, '../../data/task-schedule-record.json');
      if (fs.existsSync(任务记录文件)) {
        const 记录 = JSON.parse(fs.readFileSync(任务记录文件, 'utf-8'));
        const 今天 = new Date().toDateString();
        
        if (!记录['每日任务']) {
          记录['每日任务'] = { accounts: {} };
        }
        if (!记录['每日任务'].accounts[result.name]) {
          记录['每日任务'].accounts[result.name] = {};
        }
        if (!记录['每日任务'].accounts[result.name].dailyRecord) {
          记录['每日任务'].accounts[result.name].dailyRecord = {
            date: 今天,
            executionCount: 0
          };
        }
        
        const 今日记录 = 记录['每日任务'].accounts[result.name].dailyRecord;
        if (今日记录.date === 今天) {
          今日记录.progressFetchFailed = true;
          今日记录.lastProgressFetchTime = new Date().toISOString();
          今日记录.progressFetchFailedReason = result.progressFetchFailedReason || '未知原因';
          fs.writeFileSync(任务记录文件, JSON.stringify(记录, null, 2), 'utf-8');
          信息日志(`已记录进度获取失败标记到任务记录（调度器将在下次检测时处理）`);
        }
      }
    } catch (error) {
      警告日志(`更新任务记录失败: ${error.message}`);
    }
  }
  
  if (result.success) {
    成功日志('执行完成');
    process.exit(0);
  } else {
    错误日志(`执行失败: ${result.error}`);
    process.exit(1);
  }
}

// 全部账号模式（手动执行）
async function 执行全部账号模式(强制执行) {
  try {
    信息日志('='.repeat(60));
    信息日志('           每日任务自动执行系统');
    if (强制执行) {
      警告日志('           （强制执行模式）');
    }
    信息日志('='.repeat(60));
    信息日志('');
    
    // 1. 清理过期文件
    信息日志('步骤1: 清理过期文件...');
    清理过期日志();
    清理过期执行记录();
    清理过期状态(); // 清理过期账号状态
    信息日志('');
    
    // 2. 检查今天是否已执行
    信息日志('步骤2: 检查执行状态...');
    if (!强制执行 && 今天已执行()) {
      警告日志('今天已经执行过，跳过执行');
      信息日志('如需强制重新执行，请使用参数: node index.js --force');
      process.exit(0);
    }
    if (强制执行) {
      警告日志('强制执行模式，忽略今日执行检查');
    } else {
      成功日志('今天还未执行，开始执行任务');
    }
    信息日志('');
    
    // 3. 自动更新Token
    信息日志('步骤3: 自动更新Token...');
    try {
      const 转换脚本路径 = path.join(__dirname, '../../工具/BIN转换/转换BIN.js');
      const { stdout, stderr } = await execAsync(`node "${转换脚本路径}"`, {
        cwd: path.join(__dirname, '../..'),  // 在XYZW-wss目录下执行
        timeout: 300000 // 5分钟超时
      });
      成功日志('Token更新完成');
      if (stdout) {
        console.log(stdout);
      }
    } catch (error) {
      警告日志(`Token更新失败: ${error.message}`);
      警告日志('将使用现有Token继续执行...');
    }
    信息日志('');
    
    // 4. 读取tokens
    const tokensFile = path.join(__dirname, '../../', 主配置.tokensFile);
    const tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf-8'));
    
    if (tokens.length === 0) {
      错误日志('没有可用的Token，请先转换BIN文件');
      process.exit(1);
    }
    
    信息日志(`任务: ${任务配置.任务名称}`);
    信息日志(`频率: ${任务配置.执行频率}`);
    信息日志(`总计 ${tokens.length} 个账号`);
    信息日志('');
    
    // 6. 顺序执行所有账号（避免并发冲突）
    信息日志('开始顺序执行...');
    信息日志('');
    
    const results = [];
    let hasAnyExecution = false; // 标记是否有任何账号需要执行
    
    for (let i = 0; i < tokens.length; i++) {
      const tokenData = tokens[i];
      const accountName = tokenData.name;
      
      // 检查账号是否启用
      const 账号配置 = 获取账号配置(accountName);
      if (!账号配置 || !账号配置.启用) {
        警告日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 账号未启用，跳过`);
        results.push({
          success: false,
          name: accountName,
          error: '账号未启用'
        });
        continue;
      }
      
      // 检查每日任务是否启用
      if (!任务是否启用(accountName, '每日任务')) {
        警告日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 每日任务未启用，跳过`);
        results.push({
          success: false,
          name: accountName,
          error: '每日任务未启用'
        });
        continue;
      }
      
      // 检查该账号今天是否已执行（非强制模式）
      if (!强制执行 && 账号今天已执行(accountName)) {
        警告日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 今天已执行过，跳过`);
        results.push({
          success: true,  // 标记为成功，因为已经执行过了
          name: accountName,
          error: '今天已执行'
        });
        continue;
      }
      
      // 第一个需要执行的账号，开始执行记录
      if (!hasAnyExecution) {
        开始执行();
        hasAnyExecution = true;
      }
      
      const result = await 执行单个账号(tokenData, i, tokens.length);
      results.push(result);
      
      // 实时保存账号记录（边执行边保存）
      更新账号记录(result.name, {
        status: result.success ? 'success' : 'failed',
        error: result.error || null,
        startProgress: result.startProgress || 0,
        endProgress: result.endProgress || 0,
        duration: result.duration || '0秒'
      });
    }
    
    // 7. 统计结果
    const 成功 = results.filter(r => r.success).length;
    const 失败 = results.filter(r => !r.success).length;
    
    信息日志('');
    信息日志('='.repeat(60));
    成功日志(`所有账号执行完毕！成功: ${成功}, 失败: ${失败}`);
    
    if (失败 > 0) {
      错误日志('失败账号:');
      results.filter(r => !r.success).forEach(r => {
        错误日志(`  - ${r.name}: ${r.error}`);
      });
    }
    
    信息日志('='.repeat(60));
    信息日志('');
    
    // 8. 标记执行完成（更新结束时间）
    完成执行(tokens.length, 成功, 失败, {});
    成功日志('执行记录已保存');
    
  } catch (error) {
    错误日志('执行失败:', error.message);
    console.error(error);
    process.exit(1);
  }
}
process.on('SIGINT', () => {
  信息日志('');
  信息日志('正在退出...');
  if (client) {
    client.disconnect();
  }
  process.exit(0);
});

// 启动
main();
