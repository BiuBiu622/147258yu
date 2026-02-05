/**
 * 梦境任务 - 主程序
 * 执行频率: 每周4次（周三、周四、周日、周一）
 * 
 * 任务说明:
 * 梦境系统：战斗与购买一体化助手
 * 
 * 修复记录 (2025-12-30):
 * 1. 使用 presetteam_getinfo 获取预设阵容（而非 role_getroleinfo）
 * 2. 使用 dungeon_selecthero 选择梦境英雄（而非 role_switchformation）
 * 3. 必须先选择阵容才能获取商品列表
 * 4. 增加超时时间到15秒
 * 5. 缩短战斗间隔到0.5秒
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketClient } from '../../工具/WebSocket客户端.js';
import { 成功日志, 错误日志, 警告日志, 信息日志, 清理过期日志 } from '../../工具/日志工具.js';
import { 今天已执行, 账号今天已执行, 开始执行, 完成执行, 清理过期执行记录, 更新账号记录 } from '../../工具/执行记录.js';
import { 获取账号配置, 任务是否启用 } from '../../工具/任务配置.js';
import { 更新账号状态, 从角色信息提取状态, 清理过期状态 } from '../../工具/账号状态.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取配置
const 主配置 = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/config.json'), 'utf-8'));
const 任务配置 = JSON.parse(fs.readFileSync(path.join(__dirname, './配置.json'), 'utf-8'));

let client = null;
let currentSeq = 1;
const pendingRequests = new Map();

// 默认超时时间（增加到15秒）
const DEFAULT_TIMEOUT = 15000;

// 英雄数据映射
const heroData = {
  "101": { name: "司马懿", type: "魏国" },
  "102": { name: "郭嘉", type: "魏国" },
  "103": { name: "关羽", type: "蜀国" },
  "104": { name: "诸葛亮", type: "蜀国" },
  "105": { name: "周瑜", type: "吴国" },
  "106": { name: "太史慈", type: "吴国" },
  "107": { name: "吕布", type: "群雄" },
  "108": { name: "华佗", type: "群雄" },
  "109": { name: "甄姬", type: "魏国" },
  "110": { name: "黄月英", type: "蜀国" },
  "111": { name: "孙策", type: "吴国" },
  "112": { name: "贾诩", type: "群雄" },
  "113": { name: "曹仁", type: "魏国" },
  "114": { name: "姜维", type: "蜀国" },
  "115": { name: "孙坚", type: "吴国" },
  "116": { name: "公孙瓒", type: "群雄" },
  "117": { name: "典韦", type: "魏国" },
  "118": { name: "赵云", type: "蜀国" },
  "119": { name: "大乔", type: "吴国" },
  "120": { name: "张角", type: "群雄" }
};

// 商人配置（与开源项目保持一致）
const merchantConfig = {
  1: { name: '初级商人', items: ['进阶石', '精铁', '木质宝箱', '青铜宝箱', '普通鱼竿', '挑战票', '咸神火把'] },
  2: { name: '中级商人', items: ['梦魇晶石', '进阶石', '精铁', '黄金宝箱', '黄金鱼竿', '招募令', '橙将碎片', '紫将碎片'] },
  3: { name: '高级商人', items: ['梦魇晶石', '铂金宝箱', '黄金鱼竿', '招募令', '红将碎片', '橙将碎片', '红将碎片', '普通鱼竿'] }
};

// 金币购买的商品配置 [商人ID][商品索引]（与开源项目保持一致）
const goldItemsConfig = {
  1: [5, 6],    // 初级商人: 挑战票(5), 咸神火把(6)
  2: [6, 7],    // 中级商人: 橙将碎片(6), 紫将碎片(7)
  3: [5, 6, 7]  // 高级商人: 橙将碎片(5), 红将碎片(6), 普通鱼竿(7)
};

// 检查梦境开放时间（周三/周四/周日/周一）
function isDungeonOpen() {
  const now = new Date();
  const day = now.getDay(); // 0=周日, 1=周一, 2=周二, 3=周三, 4=周四, 5=周五, 6=周六
  return day === 0 || day === 1 || day === 3 || day === 4; // 周日、周一、周三、周四
}

// 全局消息监听器（统一处理所有响应）
function 初始化消息监听器() {
  // 避免重复添加监听器
  client.removeAllListeners('message');
  
  // 命令响应映射（响应命令 -> 原始命令）
  // 梦境相关命令的响应 ack 都是 0，需要通过命令名称匹配
  const responseMap = {
    'PresetTeam_GetInfoResp': 'presetteam_getinfo',
    'presetteam_getinforesp': 'presetteam_getinfo',
    'Dungeon_SelectHeroResp': 'dungeon_selecthero',
    'dungeon_selectheroresp': 'dungeon_selecthero',
    'Fight_StartDungeonResp': 'fight_startdungeon',
    'fight_startdungeonresp': 'fight_startdungeon',
    'Dungeon_BuyMerchantResp': 'dungeon_buymerchant',
    'dungeon_buymerchantresp': 'dungeon_buymerchant',
    'SyncRewardResp': 'dungeon_buymerchant',  // 购买商品的实际响应
    'syncrewardresp': 'dungeon_buymerchant',
    'Role_GetRoleInfoResp': 'role_getroleinfo',
    'role_getroleinforesp': 'role_getroleinfo'
  };
  
  client.on('message', (message) => {
    const ack = message.ack;
    const cmd = message.cmd;
    
    // 优先通过 ack 匹配（ack > 0 时）
    if (ack && ack > 0 && pendingRequests.has(ack)) {
      const pending = pendingRequests.get(ack);
      clearTimeout(pending.timeoutId);
      pendingRequests.delete(ack);
      pending.resolve(message);
      return;
    }
    
    // 如果 ack 为 0，通过命令名称映射匹配
    if (cmd && responseMap[cmd]) {
      const originalCmd = responseMap[cmd];
      // 查找等待该命令响应的请求
      for (const [seq, pending] of pendingRequests.entries()) {
        if (pending.cmd === originalCmd) {
          clearTimeout(pending.timeoutId);
          pendingRequests.delete(seq);
          pending.resolve(message);
          return;
        }
      }
    }
    
    // ✅ 处理错误消息（错误消息可能没有 cmd 或 cmd 不匹配）
    // 当收到错误消息时，匹配最近发送的请求
    if (message.error && pendingRequests.size > 0) {
      // 获取最早发送的请求（FIFO）
      const firstEntry = pendingRequests.entries().next().value;
      if (firstEntry) {
        const [seq, pending] = firstEntry;
        clearTimeout(pending.timeoutId);
        pendingRequests.delete(seq);
        pending.resolve(message);
        return;
      }
    }
  });
}

// 工具函数: 发送游戏指令（使用seq/ack精准匹配）
async function 发送指令(cmd, body = {}, 描述 = '', 超时时间 = DEFAULT_TIMEOUT) {
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

// 从 role.battleTeam 提取主阵容英雄列表
function 提取主阵容英雄(角色数据) {
  const 英雄列表 = [];
  
  try {
    const battleTeam = 角色数据?.role?.battleTeam;
    if (!battleTeam) {
      警告日志('role.battleTeam 不存在');
      return [];
    }
    
    // battleTeam 结构: { "1": { heroId: 107 }, "2": { heroId: 108 }, ... }
    for (const [pos, hero] of Object.entries(battleTeam)) {
      const heroId = hero.heroId || hero;
      if (heroId && heroId !== 0) {
        const info = heroData[heroId];
        英雄列表.push({
          id: heroId,
          name: info?.name || `英雄${heroId}`,
          type: info?.type || '未知',
          position: parseInt(pos)
        });
      }
    }
    
    // 按位置排序
    英雄列表.sort((a, b) => a.position - b.position);
    
    return 英雄列表;
  } catch (error) {
    错误日志(`提取主阵容英雄出错: ${error.message}`);
    return [];
  }
}

// 获取预设阵容信息（梦境专用）
async function 获取预设阵容信息() {
  信息日志('获取预设阵容信息...');
  
  try {
    const response = await 发送指令('presetteam_getinfo', {}, '获取预设阵容');
    
    if (response && response.body) {
      let 阵容数据 = response.body;
      if (阵容数据 instanceof Uint8Array) {
        const { bon } = await import('../../工具/BON协议.js');
        阵容数据 = bon.decode(阵容数据);
      }
      
      if (阵容数据?.presetTeamInfo) {
        成功日志('✅ 预设阵容信息获取成功');
        return 阵容数据;
      }
    }
    错误日志('❌ 获取预设阵容信息失败');
    return null;
  } catch (error) {
    错误日志(`❌ 获取预设阵容信息出错: ${error.message}`);
    return null;
  }
}

// 从预设阵容中提取英雄列表
function 提取预设阵容英雄(阵容数据, 目标阵容ID = 1) {
  try {
    const presetTeamInfo = 阵容数据?.presetTeamInfo?.presetTeamInfo;
    if (!presetTeamInfo) {
      错误日志('无法识别阵容数据结构');
      return [];
    }
    
    const teamInfo = presetTeamInfo[目标阵容ID.toString()]?.teamInfo;
    if (!teamInfo) {
      警告日志(`阵容${目标阵容ID}不存在`);
      return [];
    }
    
    const 英雄列表 = [];
    for (let i = 0; i < 5; i++) {
      const hero = teamInfo[i.toString()];
      if (hero) {
        const heroId = hero.heroId || hero;
        if (heroId && heroId !== 0) {
          const info = heroData[heroId];
          英雄列表.push({
            id: heroId,
            name: info?.name || `英雄${heroId}`,
            type: info?.type || '未知',
            position: i
          });
        }
      }
    }
    
    return 英雄列表;
  } catch (error) {
    错误日志(`提取预设阵容英雄出错: ${error.message}`);
    return [];
  }
}

// 分析梦境状态（从 role.dungeon.battleTeam 判断）
function 分析梦境状态(角色数据) {
  const dungeon = 角色数据?.role?.dungeon;
  
  if (!dungeon) {
    return { status: 'no_dungeon', message: '没有梦境数据', 存活英雄: [], 阵亡英雄: [], 当前关卡: 0 };
  }
  
  const 当前关卡 = dungeon.id || 0;
  const battleTeam = dungeon.battleTeam;
  
  // 检查是否已通关（200关）
  if (当前关卡 >= 200) {
    return { 
      status: 'completed', 
      message: `已通关(${当前关卡}关)，无需战斗`,
      存活英雄: [],
      阵亡英雄: [],
      当前关卡
    };
  }
  
  // 检查是否已布阵（battleTeam 为空或没有英雄）
  if (!battleTeam || Object.keys(battleTeam).length === 0) {
    return { status: 'not_deployed', message: `未布阵(当前${当前关卡}关)`, 存活英雄: [], 阵亡英雄: [], 当前关卡 };
  }
  
  // 检查英雄HP状态
  const 存活英雄 = [];
  const 阵亡英雄 = [];
  
  for (const [pos, hero] of Object.entries(battleTeam)) {
    const heroId = hero.heroId;
    const hp = hero.hp || 0;
    const initHp = hero.initHp || 0;
    const info = heroData[heroId];
    const heroInfo = {
      id: heroId,
      name: info?.name || `英雄${heroId}`,
      type: info?.type || '未知',
      position: parseInt(pos),
      hp: hp,
      initHp: initHp
    };
    
    // hp > 0 表示存活，hp = 0 且 initHp > 0 表示阵亡
    if (hp > 0) {
      存活英雄.push(heroInfo);
    } else {
      阵亡英雄.push(heroInfo);
    }
  }
  
  if (存活英雄.length === 0) {
    return { 
      status: 'all_dead', 
      message: `所有英雄已阵亡(当前${当前关卡}关)`,
      存活英雄,
      阵亡英雄,
      当前关卡
    };
  }
  
  return { 
    status: 'can_fight', 
    message: `${存活英雄.length}个存活, ${阵亡英雄.length}个阵亡(当前${当前关卡}关)`,
    存活英雄,
    阵亡英雄,
    当前关卡
  };
}

// 选择梦境阵容（使用 dungeon_selecthero）
async function 选择梦境阵容(英雄列表, 账号前缀 = '') {
  const prefix = 账号前缀 ? `${账号前缀} ` : '';
  
  if (!英雄列表 || 英雄列表.length === 0) {
    警告日志(`${prefix}没有可用英雄，跳过选择阵容`);
    return false;
  }
  
  try {
    // 构造战斗队伍数据
    const battleTeam = {};
    for (let i = 0; i < 5; i++) {
      const hero = 英雄列表.find(h => h.position === i);
      battleTeam[i.toString()] = hero ? hero.id : 0;
    }
    
    信息日志(`${prefix}选择梦境阵容: ${英雄列表.map(h => h.name).join(', ')}`);
    
    const response = await 发送指令('dungeon_selecthero', {
      battleTeam: battleTeam
    }, '选择梦境阵容');
    
    if (response) {
      成功日志(`${prefix}梦境阵容选择成功`);
      return true;
    } else {
      警告日志(`${prefix}梦境阵容选择失败`);
      return false;
    }
  } catch (error) {
    警告日志(`${prefix}选择梦境阵容出错: ${error.message}`);
    return false;
  }
}

// 单个英雄战斗
async function 英雄战斗(heroId) {
  const heroName = heroData[heroId] ? heroData[heroId].name : `ID:${heroId}`;

  try {
    const response = await 发送指令('fight_startdungeon', {
      heroId: parseInt(heroId)
    }, `英雄战斗: ${heroName}`);
    
    if (response) {
      // 检查是否有错误
      if (response.error) {
        const errorText = String(response.error);
        // 检查是否是需要停止的错误
        // 2600080/2600050: 战斗次数用完或其他限制
        // 武将已阵亡: 英雄血量为0，无法继续战斗
        if (errorText.includes('2600080') || errorText.includes('2600050') || errorText.includes('武将已阵亡')) {
          警告日志(`⏹️ ${heroName} 战斗已停止 (${errorText})`);
          return 'stop';
        }
        警告日志(`💔 ${heroName} 战斗失败: ${errorText}`);
        return false;
      }
      
      // 解析战斗结果
      let 战斗数据 = response.body;
      if (战斗数据 instanceof Uint8Array) {
        const { bon } = await import('../../工具/BON协议.js');
        战斗数据 = bon.decode(战斗数据);
      }
      
      if (战斗数据?.isWin) {
        成功日志(`🎉 ${heroName} 战斗胜利!`);
      } else {
        信息日志(`💔 ${heroName} 战斗失败`);
      }
      
      return true;
    } else {
      警告日志(`❌ ${heroName} 战斗响应为空`);
      return false;
    }
  } catch (error) {
    // 检查是否是需要停止的错误
    const errorText = error.message || '';
    if (errorText.includes('2600080') || errorText.includes('2600050') || errorText.includes('武将已阵亡')) {
      警告日志(`⏹️ ${heroName} 连续战斗已停止 (${errorText})`);
      return 'stop';
    } else {
      错误日志(`❌ ${heroName} 战斗出错: ${error.message}`);
      return false;
    }
  }
}

// 连续战斗（每个英雄循环战斗直到停止）
async function 连续战斗(英雄列表, 账号前缀 = '') {
  const prefix = 账号前缀 ? `${账号前缀} ` : '';
  
  if (!英雄列表 || 英雄列表.length === 0) {
    警告日志(`${prefix}没有可用英雄，跳过战斗`);
    return 0;
  }
  
  信息日志(`${prefix}开始连续战斗，共 ${英雄列表.length} 个英雄`);
  
  let 总战斗次数 = 0;
  const 最大连续失败次数 = 3; // 连续失败3次就跳过该英雄
  
  for (const hero of 英雄列表) {
    信息日志(`${prefix}⚔️ ${hero.name} 开始连续战斗...`);
    
    let 英雄战斗次数 = 0;
    let 连续失败次数 = 0;
    let 继续战斗 = true;
    
    while (继续战斗) {
      const result = await 英雄战斗(hero.id);
      
      if (result === 'stop') {
        // 阵亡或次数用完
        信息日志(`${prefix}${hero.name} 战斗结束（阵亡或达到限制）`);
        继续战斗 = false;
      } else if (result === false) {
        // 战斗失败（没通过关卡，但英雄没死）
        连续失败次数++;
        英雄战斗次数++;
        
        if (连续失败次数 >= 最大连续失败次数) {
          警告日志(`${prefix}${hero.name} 连续失败${连续失败次数}次，跳过该英雄`);
          继续战斗 = false;
        }
      } else {
        // 战斗胜利
        连续失败次数 = 0; // 重置连续失败计数
        英雄战斗次数++;
        总战斗次数++;
      }
      
      // 防止无限循环
      if (英雄战斗次数 >= 200) {
        警告日志(`${prefix}${hero.name} 战斗次数过多(${英雄战斗次数})，停止`);
        继续战斗 = false;
      }
      
      // 战斗间隔 0.5秒
      if (继续战斗) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    信息日志(`${prefix}${hero.name} 完成 ${英雄战斗次数} 次战斗`);
  }
  
  成功日志(`${prefix}连续战斗完成，总计 ${总战斗次数} 次胜利`);
  return 总战斗次数;
}

// 获取角色信息（包含商品列表）
async function 获取角色信息() {
  try {
    const response = await 发送指令('role_getroleinfo', {
      clientVersion: '1.65.3-wx',
      inviteUid: 0,
      platform: 'hortor',
      platformExt: 'mix',
      scene: ''
    }, '获取角色信息（商品列表）');
    
    if (!response) {
      throw new Error('获取角色信息失败，响应为空');
    }
    
    let 角色数据 = response.body;
    if (角色数据 instanceof Uint8Array) {
      const { bon } = await import('../../工具/BON协议.js');
      角色数据 = bon.decode(角色数据);
    }
    
    return 角色数据;
  } catch (error) {
    错误日志(`获取角色信息失败: ${error.message}`);
    throw error;
  }
}

// 获取商品列表（必须先选择阵容）
async function 获取商品列表(账号前缀 = '') {
  const prefix = 账号前缀 ? `${账号前缀} ` : '';
  
  try {
    const 角色数据 = await 获取角色信息();
    
    if (角色数据?.role?.dungeon?.merchant) {
      const merchantData = 角色数据.role.dungeon.merchant;
      const levelId = 角色数据.role.levelId || 0;
      
      信息日志(`${prefix}获取到商品列表，关卡ID: ${levelId}`);
      
      // 打印商品列表
      for (const merchantId in merchantData) {
        const items = merchantData[merchantId];
        const merchantName = merchantConfig[merchantId]?.name || `商人${merchantId}`;
        信息日志(`${prefix}${merchantName}: ${items.length}个商品`);
      }
      
      return { merchantData, levelId };
    } else {
      警告日志(`${prefix}未获取到商品列表数据（可能需要先选择阵容）`);
      return null;
    }
  } catch (error) {
    错误日志(`${prefix}获取商品列表失败: ${error.message}`);
    return null;
  }
}

// 购买商品
async function 购买商品(merchantId, index, pos) {
  try {
    const response = await 发送指令('dungeon_buymerchant', {
      id: merchantId,
      index: index,
      pos: pos
    }, `购买商品: 商人${merchantId}-商品${index}`);
    
    if (response) {
      return true;
    } else {
      throw new Error('购买失败');
    }
  } catch (error) {
    throw new Error(`购买商品失败: ${error.message}`);
  }
}

// 检查是否为金币商品
function isGoldItem(merchantId, index) {
  return goldItemsConfig[merchantId] && goldItemsConfig[merchantId].includes(index);
}

// ========== 按商人分类的商品检查函数 ==========

// 初级商人商品检查
function is初级挑战票(merchantId, index) {
  return merchantId === 1 && index === 5;
}

function is初级咸神火把(merchantId, index) {
  return merchantId === 1 && index === 6;
}

function is初级宝箱(merchantId, index) {
  // 木质宝箱(2), 青铜宝箱(3)
  return merchantId === 1 && (index === 2 || index === 3);
}

// 中级商人商品检查
function is中级梦魇晶石(merchantId, index) {
  return merchantId === 2 && index === 0;
}

function is中级黄金鱼竿(merchantId, index) {
  return merchantId === 2 && index === 4;
}

function is中级招募令(merchantId, index) {
  return merchantId === 2 && index === 5;
}

function is中级宝箱(merchantId, index) {
  // 黄金宝箱(3)
  return merchantId === 2 && index === 3;
}

function is中级将魂碎片(merchantId, index) {
  // 橙将碎片(6), 紫将碎片(7)
  return merchantId === 2 && (index === 6 || index === 7);
}

// 高级商人商品检查
function is高级梦魇晶石(merchantId, index) {
  return merchantId === 3 && index === 0;
}

function is高级黄金鱼竿(merchantId, index) {
  return merchantId === 3 && index === 2;
}

function is高级招募令(merchantId, index) {
  return merchantId === 3 && index === 3;
}

function is高级宝箱(merchantId, index) {
  // 铂金宝箱(1)
  return merchantId === 3 && index === 1;
}

function is高级将魂碎片(merchantId, index) {
  // 红将碎片(4), 橙将碎片(5), 红将碎片(6)
  return merchantId === 3 && (index === 4 || index === 5 || index === 6);
}

// 通用购买函数
async function 购买指定商品(merchantData, levelId, 账号前缀, 商品名称, 检查函数) {
  const prefix = 账号前缀 ? `${账号前缀} ` : '';
  
  if (levelId < 4000) {
    警告日志(`${prefix}关卡数(${levelId})小于4000，无法购买${商品名称}`);
    return { success: 0, fail: 0 };
  }

  let successCount = 0;
  let failCount = 0;

  // 遍历所有商人的商品
  for (const merchantId in merchantData) {
    const items = merchantData[merchantId];
    const numId = parseInt(merchantId);
    
    // 从后往前购买（pos从大到小）- 这是关键！
    for (let pos = items.length - 1; pos >= 0; pos--) {
      const index = items[pos];
      
      if (检查函数(numId, index)) {
        try {
          await 购买商品(numId, index, pos);
          successCount++;
          const itemName = merchantConfig[numId]?.items?.[index] || `商品${index}`;
          成功日志(`${prefix}成功购买: ${merchantConfig[numId]?.name || `商人${numId}`} - ${itemName}`);
        } catch (error) {
          failCount++;
          错误日志(`${prefix}购买失败: ${error.message}`);
        }
        
        // 延迟避免请求过快
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  if (successCount > 0 || failCount > 0) {
    成功日志(`${prefix}${商品名称}购买完成: 成功 ${successCount} 件, 失败 ${failCount} 件`);
  }
  
  return { success: successCount, fail: failCount };
}

// 梦境任务执行器
async function 执行梦境任务(角色信息, 账号前缀 = '', 账号名称 = '') {
  const 角色数据 = 角色信息?.role;
  
  if (!角色数据) {
    throw new Error('角色数据不存在');
  }
  
  const prefix = 账号前缀 ? `${账号前缀} ` : '';
  
  信息日志('');
  信息日志(`${prefix}=== 开始执行梦境任务 ===`);
  信息日志('');
  
  // 检查是否为开放时间
  if (!isDungeonOpen()) {
    警告日志('当前不是梦境开放时间（周三/周四/周日/周一）');
    return 0;
  }
  
  let 任务计数 = 0;
  
  // 获取任务配置（读取功能开关）
  const 任务配置 = 获取账号配置(账号名称, '梦境');
  const 自动战斗 = 任务配置?.自动战斗 !== false; // 默认启用
  
  // 购买配置（按商人分类）
  // 初级商人
  const 初级_挑战票 = 任务配置?.初级_挑战票 || false;
  const 初级_咸神火把 = 任务配置?.初级_咸神火把 || false;
  const 初级_宝箱 = 任务配置?.初级_宝箱 || false;
  // 中级商人
  const 中级_梦魇晶石 = 任务配置?.中级_梦魇晶石 || false;
  const 中级_黄金鱼竿 = 任务配置?.中级_黄金鱼竿 || false;
  const 中级_招募令 = 任务配置?.中级_招募令 || false;
  const 中级_宝箱 = 任务配置?.中级_宝箱 || false;
  const 中级_将魂碎片 = 任务配置?.中级_将魂碎片 || false;
  // 高级商人
  const 高级_梦魇晶石 = 任务配置?.高级_梦魇晶石 || false;
  const 高级_黄金鱼竿 = 任务配置?.高级_黄金鱼竿 || false;
  const 高级_招募令 = 任务配置?.高级_招募令 || false;
  const 高级_宝箱 = 任务配置?.高级_宝箱 || false;
  const 高级_将魂碎片 = 任务配置?.高级_将魂碎片 || false;
  
  // 是否有任何购买选项开启
  const 有购买需求 = 初级_挑战票 || 初级_咸神火把 || 初级_宝箱 ||
                    中级_梦魇晶石 || 中级_黄金鱼竿 || 中级_招募令 || 中级_宝箱 || 中级_将魂碎片 ||
                    高级_梦魇晶石 || 高级_黄金鱼竿 || 高级_招募令 || 高级_宝箱 || 高级_将魂碎片;
  
  信息日志('');
  
  信息日志(`自动战斗: ${自动战斗 ? '开' : '关'}`);
  if (有购买需求) {
    const 初级选项 = [初级_挑战票 ? '挑战票' : '', 初级_咸神火把 ? '咸神火把' : '', 初级_宝箱 ? '宝箱' : ''].filter(Boolean);
    const 中级选项 = [中级_梦魇晶石 ? '梦魇晶石' : '', 中级_黄金鱼竿 ? '黄金鱼竿' : '', 中级_招募令 ? '招募令' : '', 中级_宝箱 ? '宝箱' : '', 中级_将魂碎片 ? '将魂碎片' : ''].filter(Boolean);
    const 高级选项 = [高级_梦魇晶石 ? '梦魇晶石' : '', 高级_黄金鱼竿 ? '黄金鱼竿' : '', 高级_招募令 ? '招募令' : '', 高级_宝箱 ? '宝箱' : '', 高级_将魂碎片 ? '将魂碎片' : ''].filter(Boolean);
    if (初级选项.length > 0) 信息日志(`初级商人: ${初级选项.join(', ')}`);
    if (中级选项.length > 0) 信息日志(`中级商人: ${中级选项.join(', ')}`);
    if (高级选项.length > 0) 信息日志(`高级商人: ${高级选项.join(', ')}`);
  } else {
    信息日志('购买选项: 无');
  }
  信息日志('');
  
  // ========== 第1步：分析当前梦境状态 ==========
  信息日志('[1/4] 分析梦境状态');
  const 梦境状态 = 分析梦境状态(角色信息);
  信息日志(`当前状态: ${梦境状态.message}`);
  
  // 检查商品列表是否为空（判断是否已经完成过）
  const merchantData = 角色数据?.dungeon?.merchant;
  const 商品总数 = merchantData ? Object.values(merchantData).reduce((sum, items) => sum + (items?.length || 0), 0) : 0;
  信息日志(`商品总数: ${商品总数}`);
  
  // 如果所有英雄阵亡且商品为空，说明本周期已完成
  if ((梦境状态.status === 'all_dead' || 梦境状态.status === 'completed') && 商品总数 === 0) {
    成功日志('🎉 本周期梦境任务已完成（英雄阵亡/通关 + 商品已空）');
    return 1; // 返回成功，让调度器记录执行时间
  }
  
  let 英雄列表 = [];
  let 需要战斗 = false;
  
  if (梦境状态.status === 'completed') {
    // 已通关200关，跳过战斗，直接购物
    信息日志('🎉 已通关200关，跳过战斗，直接购物');
    需要战斗 = false;
  } else if (梦境状态.status === 'all_dead') {
    // 所有英雄已阵亡，跳过布阵和战斗，直接购物
    信息日志('所有英雄已阵亡，跳过战斗，直接购物');
    需要战斗 = false;
  } else {
    // 需要布阵或战斗
    需要战斗 = true;
    
    // ========== 第2步：获取预设阵容并布阵 ==========
    信息日志('[2/4] 获取预设阵容并布阵');
    const 阵容数据 = await 获取预设阵容信息();
    
    if (阵容数据) {
      英雄列表 = 提取预设阵容英雄(阵容数据, 1);
      信息日志(`预设阵容: ${英雄列表.map(h => h.name).join(', ')}`);
      
      // 无论是否已布阵，都尝试布阵（失败就失败）
      const 选择成功 = await 选择梦境阵容(英雄列表, 账号前缀);
      if (!选择成功) {
        信息日志('布阵命令未成功，可能已经布阵过');
      }
      任务计数++;
      
      // 等待1秒让服务器处理
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 重新获取状态，确认存活英雄
      const 新角色信息 = await 获取角色信息();
      if (新角色信息) {
        const 新状态 = 分析梦境状态({ role: 新角色信息 });
        信息日志(`布阵后状态: ${新状态.message}`);
        
        if (新状态.status === 'all_dead') {
          信息日志('所有英雄已阵亡，跳过战斗');
          需要战斗 = false;
        } else if (新状态.存活英雄.length > 0) {
          // 使用存活的英雄进行战斗
          英雄列表 = 新状态.存活英雄;
          信息日志(`存活英雄: ${英雄列表.map(h => h.name).join(', ')}`);
        }
      }
    } else {
      警告日志('获取预设阵容失败');
    }
  }
  任务计数++;
  
  // ========== 第3步：自动战斗 ==========
  if (自动战斗 && 需要战斗 && 英雄列表.length > 0) {
    信息日志('[3/4] 自动英雄战斗');
    const 战斗次数 = await 连续战斗(英雄列表, 账号前缀);
    任务计数++;
  } else {
    信息日志('[3/4] 跳过战斗');
  }
  
  // ========== 第4步：获取商品列表并购买 ==========
  信息日志('[4/4] 获取商品列表并购买');
  
  if (有购买需求) {
    // 获取商品列表
    const 商品数据 = await 获取商品列表(账号前缀);
    
    if (商品数据) {
      const { merchantData, levelId } = 商品数据;
      
      // ========== 初级商人 ==========
      if (初级_挑战票) {
        await 购买指定商品(merchantData, levelId, 账号前缀, '初级-挑战票', is初级挑战票);
      }
      if (初级_咸神火把) {
        await 购买指定商品(merchantData, levelId, 账号前缀, '初级-咸神火把', is初级咸神火把);
      }
      if (初级_宝箱) {
        await 购买指定商品(merchantData, levelId, 账号前缀, '初级-宝箱', is初级宝箱);
      }
      
      // ========== 中级商人 ==========
      if (中级_梦魇晶石) {
        await 购买指定商品(merchantData, levelId, 账号前缀, '中级-梦魇晶石', is中级梦魇晶石);
      }
      if (中级_黄金鱼竿) {
        await 购买指定商品(merchantData, levelId, 账号前缀, '中级-黄金鱼竿', is中级黄金鱼竿);
      }
      if (中级_招募令) {
        await 购买指定商品(merchantData, levelId, 账号前缀, '中级-招募令', is中级招募令);
      }
      if (中级_宝箱) {
        await 购买指定商品(merchantData, levelId, 账号前缀, '中级-宝箱', is中级宝箱);
      }
      if (中级_将魂碎片) {
        await 购买指定商品(merchantData, levelId, 账号前缀, '中级-将魂碎片', is中级将魂碎片);
      }
      
      // ========== 高级商人 ==========
      if (高级_梦魇晶石) {
        await 购买指定商品(merchantData, levelId, 账号前缀, '高级-梦魇晶石', is高级梦魇晶石);
      }
      if (高级_黄金鱼竿) {
        await 购买指定商品(merchantData, levelId, 账号前缀, '高级-黄金鱼竿', is高级黄金鱼竿);
      }
      if (高级_招募令) {
        await 购买指定商品(merchantData, levelId, 账号前缀, '高级-招募令', is高级招募令);
      }
      if (高级_宝箱) {
        await 购买指定商品(merchantData, levelId, 账号前缀, '高级-宝箱', is高级宝箱);
      }
      if (高级_将魂碎片) {
        await 购买指定商品(merchantData, levelId, 账号前缀, '高级-将魂碎片', is高级将魂碎片);
      }
      
      任务计数++;
    } else {
      警告日志('未获取到商品列表，跳过购买');
    }
  } else {
    信息日志('购买功能已关闭，跳过');
  }
  
  成功日志(`梦境任务执行完成: ${任务计数}个步骤`);
  信息日志('');
  
  return 任务计数; // 返回执行的任务数量
}

// 单个账号执行函数
async function 执行单个账号(tokenData, 账号索引, 总账号数) {
  const 账号前缀 = `[账号${账号索引 + 1}/${总账号数}: ${tokenData.name}]`;
  const 开始时间 = Date.now();
  let 任务数量 = 0;
  
  try {
    信息日志(`${账号前缀} 正在连接...`);
    
    const actualToken = tokenData.token;
    client = new WebSocketClient(主配置.wsServer, actualToken);
    
    // 连接
    await client.connect();
    成功日志(`${账号前缀} 连接成功！`);
    
    // 初始化全局消息监听器（避免并发冲突）
    初始化消息监听器();
    
    // 等待1秒后发送初始化命令
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    信息日志(`${账号前缀} 获取角色信息...`);
    
    // 获取角色信息（增加重试机制）
    let 角色信息响应 = null;
    let 角色数据 = null;
    let 重试次数 = 0;
    const 最大重试次数 = 3;
    
    while (!角色数据 && 重试次数 < 最大重试次数) {
      重试次数++;
      if (重试次数 > 1) {
        信息日志(`${账号前缀} 第 ${重试次数} 次尝试获取角色信息...`);
      }
      
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
            if (重试次数 < 最大重试次数) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
            continue;
          }
        }
        
        // 获取角色信息（增加超时时间到5秒）
        角色信息响应 = await 发送指令('role_getroleinfo', {
          clientVersion: '1.65.3-wx',
          inviteUid: 0,
          platform: 'hortor',
          platformExt: 'mix',
          scene: ''
        }, `${账号前缀} 获取角色信息`, 5000);
        
        if (!角色信息响应 || !角色信息响应.body) {
          警告日志(`${账号前缀} 服务器未返回角色信息或body为空`);
          if (重试次数 < 最大重试次数) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          continue;
        }
        
        // 解析body
        let 解析数据 = 角色信息响应.body;
        if (解析数据 instanceof Uint8Array) {
          const { bon } = await import('../../工具/BON协议.js');
          解析数据 = bon.decode(解析数据);
          if (!解析数据) {
            错误日志(`${账号前缀} BON解码失败`);
            if (重试次数 < 最大重试次数) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
            continue;
          }
        }
        
        if (!解析数据?.role) {
          错误日志(`${账号前缀} 角色数据格式错误：缺少role字段`);
          if (重试次数 < 最大重试次数) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          continue;
        }
        
        // 解析成功
        角色数据 = 解析数据;
        成功日志(`${账号前缀} ✅ 角色信息获取成功`);
        break;
        
      } catch (error) {
        错误日志(`${账号前缀} 获取角色信息异常（第${重试次数}次）: ${error.message}`);
        if (重试次数 < 最大重试次数) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    // 如果3次都失败，抛出错误
    if (!角色数据) {
      throw new Error(`获取角色信息失败，已重试 ${最大重试次数} 次`);
    }
    
    // 发送获取数据版本
    await new Promise(resolve => setTimeout(resolve, 100));
    await 发送指令('system_getdatabundlever', { isAudit: false }, `${账号前缀} 获取数据版本`, 1000);
    
    // 等待1秒后开始执行任务
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 执行梦境任务（传入账号前缀和账号名称）
    const 最终结果 = await 执行梦境任务(角色数据, 账号前缀, tokenData.name);
    任务数量 = 最终结果;
    
    // 关闭连接
    client.disconnect();
    
    const 执行时长 = Math.round((Date.now() - 开始时间) / 1000);
    成功日志(`${账号前缀} 所有任务执行完毕 (耗时: ${执行时长}秒)`);
    信息日志('');
    
    return { 
      success: true, 
      name: tokenData.name,
      taskCount: 任务数量,
      duration: `${执行时长}秒`
    };
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
      taskCount: 任务数量,
      duration: `${执行时长}秒`
    };
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
      // 全部账号模式
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
  if (!任务是否启用(账号名称, '梦境')) {
    警告日志(`梦境任务未启用，跳过`);
    process.exit(0);
  }
  
  // 执行任务
  const result = await 执行单个账号(tokenData, 0, 1);
  
  // 保存账号记录
  更新账号记录(result.name, {
    status: result.success ? 'success' : 'failed',
    error: result.error || null,
    taskCount: result.taskCount || 0,
    duration: result.duration || '0秒'
  });
  
  // ✅ 修复：无论成功或失败，都记录执行时间（避免循环）
  if (result.success) {
    成功日志('执行完成');
    process.exit(0);
  } else {
    警告日志(`执行失败: ${result.error}，但已记录执行时间（避免循环）`);
    // 失败也返回退出码0，让调度器记录执行时间
    process.exit(0);
  }
}

// 全部账号模式
async function 执行全部账号模式() {
  try {
    信息日志('='.repeat(60));
    信息日志('           梦境任务');
    信息日志('='.repeat(60));
    信息日志('');
    
    // 读取tokens
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
    
    // 顺序执行所有账号（避免并发冲突）
    信息日志('开始顺序执行...');
    信息日志('');
    
    const results = [];
    
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
      
      // 检查梦境任务是否启用
      if (!任务是否启用(accountName, '梦境')) {
        警告日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 梦境任务未启用，跳过`);
        results.push({
          success: false,
          name: accountName,
          error: '梦境任务未启用'
        });
        continue;
      }
      
      const result = await 执行单个账号(tokenData, i, tokens.length);
      results.push(result);
      
      // 实时保存账号记录（边执行边保存）
      更新账号记录(result.name, {
        status: result.success ? 'success' : 'failed',
        error: result.error || null,
        taskCount: result.taskCount || 0,
        duration: result.duration || '0秒'
      });
    }
    
    // 统计结果
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