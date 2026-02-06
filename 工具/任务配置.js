/**
 * 任务配置管理工具
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configFile = path.join(__dirname, '../data/task-config.json');
const tokensFile = path.join(__dirname, '../data/tokens.json');

// 标准任务配置模板（竞技场已独立）
const DEFAULT_TASK_CONFIG = {
  "启用": true,
  "付费招募": true,
  "领取挂机奖励": true,
  "开启宝箱": true,
  "领取盐罐": true,
  "领取邮件": true,
  "黑市购买": true,
  "购买清单": true,
  "手动购买": true,  // ✅ 修改：默认打开
  "钓鱼月度补齐": false  // ✅ 新增：默认关闭
};

const DEFAULT_ARENA_CONFIG = {
  "启用": true,
  "竞技场阵容": 1,
  "战斗次数": 3,
  "阵容切换": true,
  "月度补齐": false  // ✅ 新增：默认关闭
};

const DEFAULT_BOSS_CONFIG = {
  "启用": true,
  "战斗次数": 2,
  "BOSS阵容": 1
};

const DEFAULT_TASK_TYPES = {
  "每日任务": () => ({ ...DEFAULT_TASK_CONFIG }),
  "竞技场": () => ({ ...DEFAULT_ARENA_CONFIG }),
  "BOSS战斗": () => ({ ...DEFAULT_BOSS_CONFIG }),
  "挂机奖励": () => ({ "启用": true }),
  "盐罐机器": () => ({ "启用": true }),
  "咸鱼大冲关": () => ({ "启用": true }),
  "疯狂赛车": () => ({ "启用": true }),
  "俱乐部签到": () => ({ "启用": true }),
  "军团商店购买": () => ({ "启用": false }),  // ✅ 修改：默认关闭
  "每日咸王": () => ({ "启用": true }),
  "灯神": () => ({ "启用": true }),
  "梦境": () => ({ 
    "启用": true,
    "梦境阵容": 1,
    "自动战斗": true,  // ✅ 修改：默认打开
    "购买金币商品": false,  // ✅ 修改：默认关闭
    "购买梦魇晶石": false
  }),
  "黑市周购买": () => ({
    "启用": false,
    "购买宝箱": true,
    "购买金鱼杆": true,
    "购买贝壳": true,
    "购买白玉": true
  }),
  "咸将塔": () => ({
    "启用": true,
    "爬塔阵容": 1,
    "最大小鱼干数": 10
  }),
  "宝库": () => ({
    "启用": true
  })
};

// 生成默认任务配置
function 生成默认配置() {
  const config = {};
  Object.keys(DEFAULT_TASK_TYPES).forEach(taskName => {
    config[taskName] = DEFAULT_TASK_TYPES[taskName]();
  });
  return config;
}

// 读取任务配置
export function 读取任务配置() {
  try {
    if (!fs.existsSync(configFile)) {
      // 如果配置文件不存在，创建默认配置
      初始化配置文件();
    }
    return JSON.parse(fs.readFileSync(configFile, 'utf-8'));
  } catch (error) {
    console.error('读取任务配置失败:', error.message);
    return null;
  }
}

// 保存任务配置
export function 保存任务配置(config) {
  try {
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('保存任务配置失败:', error.message);
    return false;
  }
}

// 获取账号配置
export function 获取账号配置(accountName, taskName) {
  const config = 读取任务配置();
  if (!config) return null;
  
  // 检查账号是否存在
  if (config.账号配置 && config.账号配置[accountName]) {
    const accountConfig = config.账号配置[accountName];
    
    // 如果账号被禁用，返回null
    if (!accountConfig.启用) return null;
    
    // 返回指定任务的配置
    if (taskName && accountConfig[taskName]) {
      return accountConfig[taskName];
    }
    
    return accountConfig;
  }
  
  // 如果账号不存在，使用默认配置
  if (taskName && config.默认任务配置 && config.默认任务配置[taskName]) {
    return config.默认任务配置[taskName];
  }
  
  return config.默认任务配置;
}

// 检查任务是否启用
export function 任务是否启用(accountName, taskName) {
  const accountConfig = 获取账号配置(accountName);
  if (!accountConfig) return false;
  
  // ✅ 特殊处理：每日咸王需要同时检查每日任务总开关和每日咸王子开关
  if (taskName === '每日咸王') {
    // 检查每日任务总开关
    const 每日任务启用 = accountConfig.每日任务?.启用 === true;
    // 检查每日咸王子开关
    const 每日咸王启用 = accountConfig.每日咸王?.启用 === true;
    
    // 两个开关必须同时为true（AND关系）
    return 每日任务启用 && 每日咸王启用;
  }
  
  if (taskName && accountConfig[taskName]) {
    return accountConfig[taskName].启用 === true;
  }
  
  return true;
}

// 初始化配置文件
function 初始化配置文件() {
  try {
    // 读取tokens获取所有账号
    const tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf-8'));
    
    const config = {
      "全局设置": {
        "启用任务调度": true,
        "自动更新Token": true,
        "日志保留天数": 3  // ✅ 修改为3天
      },
      "账号配置": {},
      "默认任务配置": 生成默认配置()
    };
    
    // 为每个账号创建默认配置
    tokens.forEach(token => {
      config.账号配置[token.name] = {
        "启用": true,
        ...生成默认配置()
      };
    });
    
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8');
    console.log('任务配置文件已初始化');
    
  } catch (error) {
    console.error('初始化配置文件失败:', error.message);
  }
}

// 同步账号配置（当tokens.json变化时调用）
export function 同步账号配置() {
  try {
    let config = 读取任务配置();
    
    // 如果配置文件损坏，删除并重新初始化
    if (!config || !config.账号配置) {
      console.log('配置文件损坏，重新初始化...');
      if (fs.existsSync(configFile)) {
        fs.unlinkSync(configFile);
      }
      初始化配置文件();
      config = 读取任务配置();
      if (!config) {
        throw new Error('重新初始化配置文件失败');
      }
    }
    
    const tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf-8'));
    
    // ✅ 获取所有有效的账号名称（去重，处理重复账号）
    const 有效账号名称 = new Set();
    tokens.forEach(token => {
      if (token.name) {
        有效账号名称.add(token.name);
      }
    });
    
    // ✅ 清理已删除的账号（不在tokens.json中的账号）
    const 现有账号名称 = Object.keys(config.账号配置 || {});
    let 已删除账号数 = 0;
    现有账号名称.forEach(账号名称 => {
      if (!有效账号名称.has(账号名称)) {
        delete config.账号配置[账号名称];
        已删除账号数++;
      }
    });
    if (已删除账号数 > 0) {
      console.log(`[INFO] 已清理 ${已删除账号数} 个已删除的账号配置`);
    }
    
    // ✅ 为新账号添加默认配置，为现有账号补全缺失字段（保留已有配置值）
    有效账号名称.forEach(账号名称 => {
      // 查找对应的token（处理重复账号名的情况，使用第一个）
      const token = tokens.find(t => t.name === 账号名称);
      if (!token) return;
      
      if (!config.账号配置[账号名称]) {
        // 新账号：创建完整默认配置
        config.账号配置[账号名称] = {
          "启用": true,
          ...生成默认配置()
        };
        console.log(`[INFO] 已为新账号添加配置: ${账号名称}`);
      } else {
        // ✅ 现有账号：只补全缺失字段，保留已有配置值
        const accountConfig = config.账号配置[账号名称];
        
        // 确保账号总开关存在（如果不存在，默认为true）
        if (accountConfig.启用 === undefined) {
          accountConfig.启用 = true;
        }
        
        // 确保每日任务字段完整且统一（只补全缺失字段）
        if (!accountConfig.每日任务) {
          accountConfig.每日任务 = { ...DEFAULT_TASK_CONFIG };
        } else {
          // 移除旧的竞技场相关字段（竞技场已独立）
          delete accountConfig.每日任务.竞技场战斗;
          delete accountConfig.每日任务.竞技场阵容;
                    
          // 移除废弃的BOSS字段（BOSS已独立）
          delete accountConfig.每日任务.BOSS战斗次数;
          delete accountConfig.每日任务.BOSS阵容;
          
          // ✅ 只补全缺失的字段，保留已有值
          Object.keys(DEFAULT_TASK_CONFIG).forEach(key => {
            if (accountConfig.每日任务[key] === undefined) {
              accountConfig.每日任务[key] = DEFAULT_TASK_CONFIG[key];
            }
          });
        }
        
        // 确保竞技场配置存在（只补全缺失字段）
        if (!accountConfig.竞技场) {
          accountConfig.竞技场 = { ...DEFAULT_ARENA_CONFIG };
        } else {
          // ✅ 只补全缺失的字段，保留已有值
          Object.keys(DEFAULT_ARENA_CONFIG).forEach(key => {
            if (accountConfig.竞技场[key] === undefined) {
              accountConfig.竞技场[key] = DEFAULT_ARENA_CONFIG[key];
            }
          });
        }
        
        // 确保BOSS战斗配置存在（只补全缺失字段）
        if (!accountConfig.BOSS战斗) {
          accountConfig.BOSS战斗 = { ...DEFAULT_BOSS_CONFIG };
        } else {
          // ✅ 只补全缺失的字段，保留已有值
          Object.keys(DEFAULT_BOSS_CONFIG).forEach(key => {
            if (accountConfig.BOSS战斗[key] === undefined) {
              accountConfig.BOSS战斗[key] = DEFAULT_BOSS_CONFIG[key];
            }
          });
        }
                
        // 确保其他任务配置存在（只补全缺失字段）
        Object.keys(DEFAULT_TASK_TYPES).forEach(taskName => {
          if (taskName !== '每日任务' && taskName !== '竞技场' && taskName !== 'BOSS战斗') {
            if (!accountConfig[taskName]) {
              // 任务配置不存在，创建默认配置
              accountConfig[taskName] = DEFAULT_TASK_TYPES[taskName]();
            } else if (taskName === '梦境') {
              // ✅ 梦境任务需要补全所有字段，但保留已有值
              const 梦境默认配置 = DEFAULT_TASK_TYPES[taskName]();
              Object.keys(梦境默认配置).forEach(key => {
                if (accountConfig[taskName][key] === undefined) {
                  accountConfig[taskName][key] = 梦境默认配置[key];
                }
              });
            } else if (taskName === '黑市周购买') {
              // ✅ 黑市周购买任务需要补全所有字段，但保留已有值
              const 黑市周默认配置 = DEFAULT_TASK_TYPES[taskName]();
              Object.keys(黑市周默认配置).forEach(key => {
                if (accountConfig[taskName][key] === undefined) {
                  accountConfig[taskName][key] = 黑市周默认配置[key];
                }
              });
            }
            // 其他任务（挂机奖励、盐罐机器等）如果已存在，保留原值，不覆盖
          }
        });
      }
    });
    
    // 更新默认配置
    config.默认任务配置 = 生成默认配置();
    
    保存任务配置(config);
    return true;
    
  } catch (error) {
    console.error('同步账号配置失败:', error.message);
    return false;
  }
}
