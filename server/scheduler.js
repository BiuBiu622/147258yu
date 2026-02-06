/**
 * 统一任务调度器
 * 
 * 功能：
 * - 每20秒检测一次所有任务（自然循环）
 * - 按优先级顺序执行
 * - 按账号粒度检测，每个账号间隔5秒
 * - 每个任务模块间隔20秒
 * - 记录执行状态，避免重复执行
 * - 自动执行每日/每周/活动周清理
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { 成功日志, 错误日志, 信息日志, 警告日志, 清理过期日志 } from '../工具/日志工具.js';
import { 读取账号状态 } from '../工具/账号状态.js';
import { 执行每日清理 } from '../工具/每日清理.js';
import { 执行每周清理 } from '../工具/每周清理.js';
import { 执行活动周清理 } from '../工具/活动周清理.js';
import { 获取当前活动周类型, 获取当前活动周开始时间 } from '../工具/活动周判断.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { verifyLicense } from '../工具/internal/security/sys-verify.js';
import { getLicenseStatus } from '../工具/internal/security/sys-stat.js';
import { getMachineId } from '../工具/internal/security/sys-fingerprint.js';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 任务执行记录文件
const 任务记录文件 = path.join(__dirname, '../data/task-schedule-record.json');
const BIN检测记录文件 = path.join(__dirname, '../data/bin-check-record.json');
const 清理记录文件 = path.join(__dirname, '../data/cleanup-record.json');

// 获取今天的日期字符串
function 获取今天日期() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 读取清理记录
function 读取清理记录() {
  try {
    if (!fs.existsSync(清理记录文件)) {
      // 文件不存在，返回默认值
      return {
        lastDailyCleanupDate: null,
        lastWeeklyCleanupDate: null,
        lastLogCleanupDate: null
      };
    }
    return JSON.parse(fs.readFileSync(清理记录文件, 'utf-8'));
  } catch (error) {
    错误日志('读取清理记录失败:', error.message);
    return {
      lastDailyCleanupDate: null,
      lastWeeklyCleanupDate: null,
      lastLogCleanupDate: null
    };
  }
}

// 保存清理记录
function 保存清理记录(记录) {
  try {
    const dataDir = path.dirname(清理记录文件);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(清理记录文件, JSON.stringify(记录, null, 2), 'utf-8');
  } catch (error) {
    错误日志('保存清理记录失败:', error.message);
  }
}

// 从文件读取上次清理日期（启动时调用）
const 清理记录 = 读取清理记录();
let 上次日志清理日期 = 清理记录.lastLogCleanupDate || 获取今天日期();
let 上次状态清除日期 = 清理记录.lastDailyCleanupDate || 获取今天日期();
let 上次每周清理日期 = 清理记录.lastWeeklyCleanupDate || null;

// 计算本周一的日期字符串
function 获取本周一日期() {
  const now = new Date();
  const 星期几 = now.getDay(); // 0=周日, 1=周一, ..., 6=周六
  const 距离周一天数 = 星期几 === 0 ? 6 : 星期几 - 1; // 周日距离周一6天，其他距离周一天数-1

  const 本周一 = new Date(now);
  本周一.setDate(now.getDate() - 距离周一天数);
  本周一.setHours(0, 0, 0, 0);

  const year = 本周一.getFullYear();
  const month = String(本周一.getMonth() + 1).padStart(2, '0');
  const day = String(本周一.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

// 清除每日任务执行时间记录（每天0点调用）
// 注意：此函数仅清除每日任务的记录，不清除周期性任务（梦境、答题、赛车等）
function 清除每日任务执行时间记录() {
  try {
    if (fs.existsSync(任务记录文件)) {
      // 读取现有记录
      const 记录 = JSON.parse(fs.readFileSync(任务记录文件, 'utf-8'));

      // 需要每日清除的任务列表（只包含每日任务）
      const 每日任务列表 = ['每日任务', '签到', '俱乐部签到', '竞技场', '每日咸王', '灯神', 'BOSS战斗'];

      // 只清除每日任务的执行时间记录，保留周期性任务（梦境、答题、赛车等）
      Object.keys(记录).forEach(任务名称 => {
        // 只清除每日任务列表中的任务
        if (每日任务列表.includes(任务名称) && 记录[任务名称].accounts) {
          Object.keys(记录[任务名称].accounts).forEach(账号名称 => {
            // 保留账号结构，但清除执行时间
            delete 记录[任务名称].accounts[账号名称].lastExecutionTime;
            delete 记录[任务名称].accounts[账号名称].lastStatus;
            delete 记录[任务名称].accounts[账号名称].dailyRecord;
          });
        }
      });

      // 保存清除后的记录
      fs.writeFileSync(任务记录文件, JSON.stringify(记录, null, 2), 'utf-8');
      成功日志('✅ 每日任务执行时间记录已清除（梦境、答题、赛车等周期性任务已保留）');
    }
  } catch (error) {
    错误日志('清除每日任务执行时间记录失败:', error.message);
  }
}

// 读取BIN目录状态
function 读取BIN目录状态() {
  try {
    const binDir = path.join(__dirname, '../BIN文件');

    if (!fs.existsSync(binDir)) {
      return { count: 0, files: {} };
    }

    const files = fs.readdirSync(binDir).filter(f => f.endsWith('.bin'));
    const filesInfo = {};

    files.forEach(file => {
      const filePath = path.join(binDir, file);
      const stats = fs.statSync(filePath);
      filesInfo[file] = {
        size: stats.size,
        mtime: stats.mtime.getTime()
      };
    });

    return {
      count: files.length,
      files: filesInfo
    };
  } catch (error) {
    错误日志('读取BIN目录失败:', error.message);
    return { count: 0, files: {} };
  }
}

// 读取上次BIN检测记录
function 读取BIN检测记录() {
  try {
    if (!fs.existsSync(BIN检测记录文件)) {
      return { count: 0, files: {} };
    }
    return JSON.parse(fs.readFileSync(BIN检测记录文件, 'utf-8'));
  } catch (error) {
    return { count: 0, files: {} };
  }
}

// 保存BIN检测记录
function 保存BIN检测记录(状态) {
  try {
    const dataDir = path.dirname(BIN检测记录文件);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(BIN检测记录文件, JSON.stringify(状态, null, 2), 'utf-8');
  } catch (error) {
    错误日志('保存BIN检测记录失败:', error.message);
  }
}

// 检测BIN文件是否有变化
function BIN文件有变化() {
  const 当前状态 = 读取BIN目录状态();
  const 上次状态 = 读取BIN检测记录();

  // 检查文件数量
  if (当前状态.count !== 上次状态.count) {
    信息日志(`BIN文件数量变化: ${上次状态.count} → ${当前状态.count}`);
    return true;
  }

  // 检查文件详情
  const 当前文件列表 = Object.keys(当前状态.files);
  const 上次文件列表 = Object.keys(上次状态.files);

  // 检查是否有新增或删除的文件
  for (const file of 当前文件列表) {
    if (!上次状态.files[file]) {
      信息日志(`检测到新增BIN文件: ${file}`);
      return true;
    }

    // 检查文件是否被修改（大小或修改时间变化）
    if (当前状态.files[file].size !== 上次状态.files[file].size ||
      当前状态.files[file].mtime !== 上次状态.files[file].mtime) {
      信息日志(`检测到BIN文件变化: ${file}`);
      return true;
    }
  }

  for (const file of 上次文件列表) {
    if (!当前状态.files[file]) {
      信息日志(`检测到删除BIN文件: ${file}`);
      return true;
    }
  }

  return false;
}

// 检测Token是否过期（24小时刷新一次）
function 检测Token是否过期() {
  try {
    const tokensFile = path.join(__dirname, '../data/tokens.json');
    if (!fs.existsSync(tokensFile)) {
      return false;
    }

    const stats = fs.statSync(tokensFile);
    const now = new Date();
    const fileTime = new Date(stats.mtime);

    // 计算时间差（毫秒）
    const diff = now.getTime() - fileTime.getTime();
    const hours = diff / (1000 * 60 * 60);

    // 超过24小时需要刷新
    return hours >= 24;
  } catch (error) {
    错误日志('检测Token过期时间失败:', error.message);
    return false;
  }
}

// 检测并转换BIN
async function 检查并转换BIN() {
  try {
    // 1. 检查Token是否需要刷新（24小时刷新一次）
    const 需要刷新Token = 检测Token是否过期();

    // 2. 检查BIN文件是否有变化
    const BIN有变化 = BIN文件有变化();

    // 如果Token需要刷新或BIN有变化，就执行转换
    if (!需要刷新Token && !BIN有变化) {
      // 信息日志('BIN文件无变化，Token也未过期，跳过转换'); // 降低日志频率
      return true;
    }

    信息日志('============================================================');
    if (需要刷新Token) {
      const 现在 = new Date();
      const 当前时间 = `${现在.getHours().toString().padStart(2, '0')}:${现在.getMinutes().toString().padStart(2, '0')}`;
      成功日志(`⚡ 到达Token定时刷新时间点: ${当前时间}`);
      信息日志('开始Token定时刷新...');
    }

    if (BIN有变化) {
      信息日志('检测到BIN文件变化，开始转换所有Token...');
    }
    信息日志('============================================================');

    const 转换脚本路径 = path.join(__dirname, '../工具/BIN转换/转换BIN.js');
    if (!fs.existsSync(转换脚本路径)) {
      警告日志('转换脚本不存在，跳过Token更新');
      return false;
    }

    // 使用项目根目录作为工作目录，确保路径正确
    const 项目根目录 = path.join(__dirname, '..');

    const { stdout, stderr } = await execAsync(`node "工具/BIN转换/转换BIN.js"`, {
      cwd: 项目根目录,  // ✅ 使用项目根目录
      timeout: 300000 // 5分钟超时
    });

    if (stderr) {
      警告日志('转换过程有警告信息:', stderr);
    }

    if (stdout) {
      信息日志('转换输出:', stdout);
    }

    // 更新BIN检测记录
    保存BIN检测记录(读取BIN目录状态());

    成功日志('✅ Token转换完成');
    return true;

  } catch (error) {
    错误日志('Token转换失败:', error.message);
    if (error.stdout) 信息日志('标准输出:', error.stdout);
    if (error.stderr) 错误日志('错误输出:', error.stderr);
    return false;
  }
}

// 任务列表（按优先级排序）
const 任务列表 = [
  {
    名称: '每日任务',
    脚本路径: '../任务/每日任务/index.js',
    执行间隔: 24 * 60 * 60 * 1000, // 24小时
    优先级: 1,
    检测时间: (上次执行时间) => {
      if (!上次执行时间) return true;
      const now = new Date();
      const lastTime = new Date(上次执行时间);
      // 每天执行一次
      return now.toDateString() !== lastTime.toDateString();
    }
  },
  {
    名称: '盐罐机器',
    脚本路径: '../任务/盐罐机器/index.js',
    执行间隔: 6 * 60 * 60 * 1000, // 6小时
    优先级: 2,
    检测时间: (上次执行时间) => {
      if (!上次执行时间) return true;
      const now = new Date();
      const lastTime = new Date(上次执行时间);
      const diff = now.getTime() - lastTime.getTime();
      // 每6小时执行一次
      return diff >= 6 * 60 * 60 * 1000;
    }
  },
  {
    名称: '挂机奖励',
    脚本路径: '../任务/挂机奖励/index.js',
    执行间隔: 6 * 60 * 60 * 1000, // 6小时
    优先级: 3,
    检测时间: (上次执行时间) => {
      if (!上次执行时间) return true;
      const now = new Date();
      const lastTime = new Date(上次执行时间);
      const diff = now.getTime() - lastTime.getTime();
      // 每6小时执行一次
      return diff >= 6 * 60 * 60 * 1000;
    }
  },
  {
    名称: 'BOSS战斗',
    脚本路径: '../任务/BOSS战斗/index.js',
    执行间隔: 24 * 60 * 60 * 1000, // 24小时
    优先级: 4,
    检测时间: (上次执行时间) => {
      if (!上次执行时间) return true;
      const now = new Date();
      const lastTime = new Date(上次执行时间);
      // 每天执行一次
      return now.toDateString() !== lastTime.toDateString();
    }
  },
  {
    名称: '咸将塔',
    脚本路径: '../任务/咸将塔/index.js',
    执行间隔: 6 * 60 * 60 * 1000, // 6小时
    优先级: 4.5,
    检测时间: (上次执行时间) => {
      if (!上次执行时间) return true;
      const now = new Date();
      const lastTime = new Date(上次执行时间);
      const diff = now.getTime() - lastTime.getTime();
      // 每6小时执行一次
      return diff >= 6 * 60 * 60 * 1000;
    }
  },
  {
    名称: '竞技场',
    脚本路径: '../任务/竞技场/index.js',
    执行间隔: 24 * 60 * 60 * 1000, // 24小时
    优先级: 5,
    检测时间: (上次执行时间) => {
      const now = new Date();
      const hour = now.getHours();

      // 新账号立即执行（忽略时间限制）
      if (!上次执行时间) return true;

      // 时间窗口: 8:00-21:59（开放时间内可运行）
      if (hour < 8 || hour >= 22) {
        return false; // 非开放时间，等次日
      }

      const lastTime = new Date(上次执行时间);
      // 每天执行一次
      return now.toDateString() !== lastTime.toDateString();
    }
  },
  {
    名称: '俱乐部签到',
    脚本路径: '../任务/俱乐部签到/index.js',
    执行间隔: 24 * 60 * 60 * 1000, // 24小时
    优先级: 6,
    检测时间: (上次执行时间) => {
      if (!上次执行时间) return true;
      const now = new Date();
      const lastTime = new Date(上次执行时间);
      // 每天执行一次
      return now.toDateString() !== lastTime.toDateString();
    }
  },
  {
    名称: '咸鱼大冲关',
    脚本路径: '../任务/咸鱼大冲关/index.js',
    执行间隔: 7 * 24 * 60 * 60 * 1000, // 7天（每周任务）
    优先级: 7,
    检测时间: (上次执行时间, 账号名称) => {
      const now = new Date();

      // 读取账号状态，优先检查本周答题是否完成
      const 所有账号状态 = 读取账号状态();
      const 账号状态 = 所有账号状态[账号名称];

      // 检查本周答题状态（优先级最高）
      if (账号状态 && 账号状态.study) {
        const study = 账号状态.study;
        const maxCorrectNum = study.maxCorrectNum || 0;
        const beginTime = study.beginTime || 0;

        // 如果本周已答对10题，检查是否已记录执行时间
        if (maxCorrectNum >= 10 && beginTime > 0) {
          // 计算本周一凌晨的时间
          const 本周一 = new Date(now);
          本周一.setHours(0, 0, 0, 0);
          const 今天是周几 = now.getDay();
          const 距离周一天数 = 今天是周几 === 0 ? 6 : 今天是周几 - 1;
          本周一.setDate(now.getDate() - 距离周一天数);

          // 判断答题时间是否在本周内
          const 答题日期 = new Date(beginTime * 1000);
          if (答题日期 >= 本周一) {
            // 本周已完成10题，检查是否已记录执行时间
            if (!上次执行时间) {
              // 没有记录，需要执行一次以记录时间
              return true;
            }

            const lastTime = new Date(上次执行时间);
            // 如果执行时间在本周内，则跳过
            if (lastTime >= 本周一) {
              return false; // 本周已记录，跳过
            } else {
              // 执行时间在上周，需要重新执行以记录本周时间
              return true;
            }
          }
        }
      }

      // 本周未完成10题，检查今天是否已执行过
      // 新账号立即执行
      if (!上次执行时间) return true;

      const lastTime = new Date(上次执行时间);
      const 是今天 = now.toDateString() === lastTime.toDateString();

      // 如果今天已执行过，跳过（每天只执行一次）
      if (是今天) {
        return false;
      }

      // 本周未完成且今天未执行，需要执行
      return true;
    }
  },
  {
    名称: '疯狂赛车',
    脚本路径: '../任务/疯狂赛车/index.js',
    执行间隔: 24 * 60 * 60 * 1000, // 24小时
    优先级: 8,
    检测时间: (上次执行时间, 账号名称) => {
      const now = new Date();
      const weekday = now.getDay();
      const hour = now.getHours();

      // 只在周一、二、三执行
      if (weekday !== 1 && weekday !== 2 && weekday !== 3) {
        return false;
      }

      // 时间窗口：8:00-18:00
      if (hour < 8 || hour >= 18) {
        return false;
      }

      // 新账号立即执行
      if (!上次执行时间) return true;

      // 读取任务记录，获取今日执行次数
      const 记录 = 读取任务记录();
      const 今天 = now.toDateString();
      const 今日记录 = 记录['疯狂赛车']?.accounts?.[账号名称]?.dailyRecord || {};
      const 今日执行次数 = (今日记录.date === 今天) ? (今日记录.executionCount || 0) : 0;

      // 每天最多执行2次
      if (今日执行次数 >= 2) {
        return false;
      }

      // 第1次：立即执行
      if (今日执行次数 === 0) {
        return true;
      }

      // 第2次：间隔2小时
      const lastTime = new Date(上次执行时间);
      const 距离上次 = now.getTime() - lastTime.getTime();
      return 距离上次 >= 2 * 60 * 60 * 1000;
    }
  },
  {
    名称: '军团商店购买',
    脚本路径: '../任务/军团商店购买/index.js',
    执行间隔: 7 * 24 * 60 * 60 * 1000, // 7天（每周任务）
    优先级: 9,
    检测时间: (上次执行时间, 账号名称) => {
      const now = new Date();

      // 读取账号状态，检查本周是否已购买
      const 所有账号状态 = 读取账号状态();
      const 账号状态 = 所有账号状态[账号名称];

      if (账号状态 && 账号状态.legionShop) {
        const 购买日期 = 账号状态.legionShop.购买日期;
        if (购买日期) {
          const 购买时间 = new Date(购买日期);
          const 本周一 = new Date(now);
          本周一.setHours(0, 0, 0, 0);
          const 距离周一天数 = now.getDay() === 0 ? 6 : now.getDay() - 1;
          本周一.setDate(now.getDate() - 距离周一天数);

          // 本周已购买，跳过
          if (购买时间 >= 本周一) {
            return false;
          }
        }
      }

      // 本周未购买，可以执行（全时间段开放）
      return true;
    }
  },
  {
    名称: '黑市周购买',
    脚本路径: '../任务/黑市周购买/index.js',
    执行间隔: 7 * 24 * 60 * 60 * 1000, // 7天（活动周任务）
    优先级: 10,
    检测时间: (上次执行时间, 账号名称) => {
      const now = new Date();

      // 检查当前是否是黑市周
      const 当前活动周类型 = 获取当前活动周类型(now);
      if (当前活动周类型 !== '黑市周') {
        return false; // 不是黑市周，跳过
      }

      // 检查是否在购买时间窗口内（周五12:00 - 下周四23:00）
      const 今天周几 = now.getDay();
      const 当前小时 = now.getHours();

      // 周五：12:00之后才开放
      if (今天周几 === 5 && 当前小时 < 12) {
        return false;
      }

      // 周四：23:00之后关闭
      if (今天周几 === 4 && 当前小时 >= 23) {
        return false;
      }

      // 读取账号状态，检查本活动周是否已购买
      const 所有账号状态 = 读取账号状态();
      const 账号状态 = 所有账号状态[账号名称];

      if (账号状态 && 账号状态.blackMarketWeek) {
        const 购买日期 = 账号状态.blackMarketWeek.购买日期;
        if (购买日期) {
          const 购买时间 = new Date(购买日期);
          const 当前活动周开始时间 = 获取当前活动周开始时间(now);

          // 本活动周已购买，跳过
          if (购买时间.getTime() >= 当前活动周开始时间.getTime()) {
            return false;
          }
        }
      }

      // 本活动周未购买，可以执行
      return true;
    }
  },
  // ✅ 删除重复的第1个每日咸王定义，保留完整版本
  {
    名称: '每日咸王',
    脚本路径: '../任务/每日咸王/index.js',
    执行间隔: 24 * 60 * 60 * 1000, // 24小时
    优先级: 10,
    检测时间: (上次执行时间, 账号名称) => {
      const now = new Date();

      // 新账号立即执行
      if (!上次执行时间) return true;

      const lastTime = new Date(上次执行时间);
      const 是今天 = now.toDateString() === lastTime.toDateString();

      // ✅ 不管完成没完成，一天只打一次
      if (是今天) {
        return false; // 今天已执行过，跳过
      }

      // 非今天 → 可以执行
      return true;
    }
  },
  {
    名称: '灯神',
    脚本路径: '../任务/灯神/index.js',
    执行间隔: 24 * 60 * 60 * 1000, // 24小时
    优先级: 11,
    检测时间: (上次执行时间, 账号名称) => {
      const now = new Date();

      // 新账号立即执行
      if (!上次执行时间) return true;

      const lastTime = new Date(上次执行时间);
      const 是今天 = now.toDateString() === lastTime.toDateString();

      // ✅ 不管完成没完成，一天只打一次
      if (是今天) {
        return false; // 今天已执行过，跳过
      }

      // 非今天 → 可以执行
      return true;
    }
  },
  {
    名称: '梦境',
    脚本路径: '../任务/梦境/index.js',
    执行间隔: 24 * 60 * 60 * 1000, // 24小时
    优先级: 12,
    检测时间: (上次执行时间, 账号名称) => {
      const now = new Date();
      const weekday = now.getDay(); // 0=周日, 1=周一, 2=周二, 3=周三, 4=周四, 5=周五, 6=周六

      // 检查是否为开放日（周日/周一/周三/周四）
      const isOpenDay = (weekday === 0 || weekday === 1 || weekday === 3 || weekday === 4);

      // 如果不是开放日，不执行
      if (!isOpenDay) {
        return false;
      }

      // 新账号立即执行
      if (!上次执行时间) return true;

      const lastTime = new Date(上次执行时间);
      const lastWeekday = lastTime.getDay();

      // 判断当前在哪个周期：周日-周一 或 周三-周四
      const 当前周期 = (weekday === 0 || weekday === 1) ? 1 : 2; // 1=周日-周一, 2=周三-周四
      const 上次周期 = (lastWeekday === 0 || lastWeekday === 1) ? 1 : 2;

      // 计算时间间隔（天数）
      const 时间间隔毫秒 = now.getTime() - lastTime.getTime();
      const 时间间隔天数 = Math.floor(时间间隔毫秒 / (24 * 60 * 60 * 1000));

      // 如果在同一个周期内，且间隔小于3天，不重复执行
      if (当前周期 === 上次周期 && 时间间隔天数 < 3) {
        return false; // 本周期已执行过，跳过
      }

      // 不同周期 或 间隔超过3天 → 可以执行
      return true;
    }
  },
  {
    名称: '宝库',
    脚本路径: '../任务/宝库/index.js',
    执行间隔: 7 * 24 * 60 * 60 * 1000, // 7天（周任务）
    优先级: 13,
    检测时间: (上次执行时间, 账号名称) => {
      const now = new Date();
      const weekday = now.getDay(); // 0=周日, 1=周一, 2=周二, 3=周三, 4=周四, 5=周五, 6=周六

      // 检查是否为开放日（周三至周日，周一周二不开放）
      const isOpenDay = (weekday !== 1 && weekday !== 2);

      // 如果不是开放日，不执行
      if (!isOpenDay) {
        return false;
      }

      // 新账号立即执行
      if (!上次执行时间) return true;

      const lastTime = new Date(上次执行时间);

      // 计算本周三凌晨的时间（周任务从周三开始）
      const 本周三 = new Date(now);
      本周三.setHours(0, 0, 0, 0);
      const 今天是周几 = now.getDay();
      // 计算距离本周三的天数
      let 距离周三天数;
      if (今天是周几 >= 3) {
        距离周三天数 = 今天是周几 - 3;
      } else {
        // 周日(0)、周一(1)、周二(2) 不开放，不会执行到这里
        距离周三天数 = 今天是周几 + 4;
      }
      本周三.setDate(now.getDate() - 距离周三天数);

      // 如果上次执行时间在本周三之后，说明本周已执行过
      if (lastTime >= 本周三) {
        return false; // 本周已执行，跳过
      }

      // 本周未执行，可以执行
      return true;
    }
  },
  {
    名称: '竞技场月度补齐',
    脚本路径: '../任务/竞技场月度补齐/index.js',
    执行间隔: 24 * 60 * 60 * 1000, // 24小时
    优先级: 14,
    检测时间: (上次执行时间, 账号名称) => {
      const now = new Date();
      const hour = now.getHours();

      // 时间窗口: 8:00-21:59（竞技场开放时间内）
      if (hour < 8 || hour >= 22) {
        return false;
      }

      // 新账号立即执行
      if (!上次执行时间) return true;

      const lastTime = new Date(上次执行时间);
      // 每天执行一次
      return now.toDateString() !== lastTime.toDateString();
    }
  },
  {
    名称: '钓鱼月度补齐',
    脚本路径: '../任务/钓鱼月度补齐/index.js',
    执行间隔: 24 * 60 * 60 * 1000, // 24小时
    优先级: 15,
    检测时间: (上次执行时间, 账号名称) => {
      const now = new Date();
      const hour = now.getHours();

      // 时间窗口: 8:00-21:59
      if (hour < 8 || hour >= 22) {
        return false;
      }

      // 新账号立即执行
      if (!上次执行时间) return true;

      const lastTime = new Date(上次执行时间);
      // 每天执行一次
      return now.toDateString() !== lastTime.toDateString();
    }
  },
  {
    名称: '怪异塔',
    脚本路径: '../任务/怪异塔/index.js',
    执行间隔: 6 * 60 * 60 * 1000, // 6小时
    优先级: 16,
    检测时间: (上次执行时间, 账号名称) => {
      // 怪异塔活动不固定开放，任务内部会检测活动状态
      // 每天13点后检测一次活动是否开放
      // 如果活动未开放，任务会自动跳过

      if (!上次执行时间) return true;

      const now = new Date();
      const lastTime = new Date(上次执行时间);
      const diff = now.getTime() - lastTime.getTime();

      // 每6小时执行一次（与咸将塔一致）
      return diff >= 6 * 60 * 60 * 1000;
    }
  }
];

// 读取任务配置
function 读取任务配置() {
  try {
    const configPath = path.join(__dirname, '../data/task-config.json');
    if (!fs.existsSync(configPath)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (error) {
    错误日志('读取任务配置失败:', error.message);
    return {};
  }
}

// 读取任务执行记录
function 读取任务记录() {
  try {
    if (!fs.existsSync(任务记录文件)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(任务记录文件, 'utf-8'));
  } catch (error) {
    错误日志('读取任务记录失败:', error.message);
    return {};
  }
}

// 保存任务执行记录
function 保存任务记录(记录) {
  try {
    const dataDir = path.dirname(任务记录文件);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(任务记录文件, JSON.stringify(记录, null, 2), 'utf-8');
  } catch (error) {
    错误日志('保存任务记录失败:', error.message);
  }
}

// 更新任务执行时间（按账号）
// 注意：调度器是顺序执行的，不存在并发问题，但保留验证逻辑以防其他原因导致保存失败
function 更新任务执行时间(任务名称, 账号名称, 成功 = true, 额外数据 = {}) {
  try {
    const 记录 = 读取任务记录();

    // 初始化任务记录
    if (!记录[任务名称]) {
      记录[任务名称] = {
        accounts: {}
      };
    }

    // 初始化账号记录
    if (!记录[任务名称].accounts[账号名称]) {
      记录[任务名称].accounts[账号名称] = {};
    }

    // 更新基础信息
    记录[任务名称].accounts[账号名称].lastExecutionTime = new Date().toISOString();
    记录[任务名称].accounts[账号名称].lastStatus = 成功 ? 'success' : 'failed';

    // 如果是每日任务或疯狂赛车，记录特殊数据
    if (任务名称 === '每日任务' || 任务名称 === '疯狂赛车') {
      const 今天 = new Date().toDateString();
      let 今日记录 = 记录[任务名称].accounts[账号名称].dailyRecord || {};

      // 检查是否是新的一天，如果是则重置
      if (今日记录.date !== 今天) {
        今日记录 = {
          date: 今天,
          executionCount: 0
        };
      }

      // 更新执行次数
      if (任务名称 === '每日任务' && 额外数据.基础任务) {
        今日记录.executionCount = (今日记录.executionCount || 0) + 1;

        // 如果进度获取失败，记录标记和时间
        if (额外数据.progressFetchFailed) {
          今日记录.progressFetchFailed = true;
          今日记录.lastProgressFetchTime = new Date().toISOString();
          今日记录.progressFetchFailedReason = 额外数据.progressFetchFailedReason || '未知原因';
        } else {
          // 进度获取成功，清除标记
          if (今日记录.progressFetchFailed) {
            delete 今日记录.progressFetchFailed;
            delete 今日记录.lastProgressFetchTime;
            delete 今日记录.progressFetchFailedReason;
          }
        }
      } else if (任务名称 === '疯狂赛车') {
        今日记录.executionCount = (今日记录.executionCount || 0) + 1;
      }

      记录[任务名称].accounts[账号名称].dailyRecord = 今日记录;
    }

    // 保存任务记录
    保存任务记录(记录);

    // ✅ 验证保存是否成功（用于排查问题）
    const 验证记录 = 读取任务记录();
    const 验证账号记录 = 验证记录[任务名称]?.accounts?.[账号名称];
    if (!验证账号记录 || !验证账号记录.lastExecutionTime) {
      警告日志(`    ⚠️ 警告: 任务记录保存后验证失败: ${任务名称} - ${账号名称}`);
    }
  } catch (error) {
    错误日志(`    ✗ 更新任务执行时间失败: ${error.message}`);
  }
}

// 获取账号执行时间
function 获取账号执行时间(任务名称, 账号名称) {
  const 记录 = 读取任务记录();

  if (!记录[任务名称] || !记录[任务名称].accounts) {
    return null;
  }

  const 账号记录 = 记录[任务名称].accounts[账号名称];
  return 账号记录 ? 账号记录.lastExecutionTime : null;
}

// 计算剩余时间显示
function 计算剩余时间(上次执行时间, 执行间隔) {
  if (!上次执行时间) return '未执行过';

  const 现在 = new Date();
  const 上次 = new Date(上次执行时间);
  const 下次执行 = new Date(上次.getTime() + 执行间隔);

  const 差值 = 下次执行 - 现在;

  if (差值 <= 0) {
    return '已到达执行时间';
  }

  const 小时 = Math.floor(差值 / (60 * 60 * 1000));
  const 分钟 = Math.floor((差值 % (60 * 60 * 1000)) / (60 * 1000));

  if (小时 > 0) {
    return `${小时}小时${分钟}分钟`;
  } else {
    return `${分钟}分钟`;
  }
}

// 格式化时间显示
function 格式化时间(时间字符串) {
  if (!时间字符串) return '未执行过';
  const date = new Date(时间字符串);
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

// 执行单个账号的任务
async function 执行账号任务(任务, 账号名称) {
  信息日志(`  ▶ 执行: [账号: ${账号名称}]`);

  try {
    const 脚本完整路径 = path.join(__dirname, 任务.脚本路径);

    // 检查脚本是否存在
    if (!fs.existsSync(脚本完整路径)) {
      警告日志(`    任务脚本不存在: ${脚本完整路径}`);
      return false;
    }

    // 准备执行参数
    const 执行参数 = ['--account', 账号名称];
    let 额外数据 = null; // 提到外面，供后面使用

    // 如果是每日任务，检查进度和重试次数
    if (任务.名称 === '每日任务') {
      const 记录 = 读取任务记录();
      const 所有账号状态 = 读取账号状态();
      const 账号状态 = 所有账号状态[账号名称];

      const 今日记录 = 记录['每日任务']?.accounts?.[账号名称]?.dailyRecord || {};
      const 今日执行次数 = 今日记录.executionCount || 0;
      const 进度 = 账号状态?.dailyTask?.dailyPoint || 0;
      const 进度获取失败 = 今日记录.progressFetchFailed || false;
      const 最后获取时间 = 今日记录.lastProgressFetchTime ? new Date(今日记录.lastProgressFetchTime) : null;

      // 任务总分是110分，>=70分 任务成功
      const 成功阈值 = 70;

      // 情况1：进度>=70分 且 已执行过 -> 跳过（无论是否获取失败）
      if (进度 >= 成功阈值 && 今日执行次数 > 0) {
        信息日志(`    跳过: 进度已达 ${进度}/110 (>= ${成功阈值})`);

        // 如果之前有进度获取失败的标记，现在进度已达标，清除标记
        if (进度获取失败) {
          const 更新记录 = 读取任务记录();
          if (更新记录['每日任务']?.accounts?.[账号名称]?.dailyRecord) {
            delete 更新记录['每日任务'].accounts[账号名称].dailyRecord.progressFetchFailed;
            delete 更新记录['每日任务'].accounts[账号名称].dailyRecord.lastProgressFetchTime;
            delete 更新记录['每日任务'].accounts[账号名称].dailyRecord.progressFetchFailedReason;
            保存任务记录(更新记录);
            信息日志(`    已清除进度获取失败标记（进度已达标）`);
          }
        }
        return null;
      }

      // 情况2：进度获取失败，但任务已执行过 -> 跳过（不重新做任务）
      // 注意：分数获取要么失败要么成功，跟任务没关系
      // 如果获取失败，可能是网络问题，但任务可能已经完成了，不应该重新做任务
      // 只有获取到进度且<70分才算任务失败，需要重新做任务
      if (进度获取失败 && 今日执行次数 > 0) {
        警告日志(`    跳过: 上次进度获取失败，但任务可能已经完成`);
        警告日志(`    原因: ${今日记录.progressFetchFailedReason || '未知'}`);
        警告日志(`    当前进度: ${进度}/110（可能不准确）`);
        警告日志(`    注意: 只有获取到进度且<70分才算任务失败，进度获取失败不影响任务状态`);
        return null; // 跳过，不重新做任务
      }

      // 情况3：执行次数>=3 -> 跳过（防止无限循环）
      if (今日执行次数 >= 3) {
        警告日志(`    跳过: 已重试3次，当前进度 ${进度}/110`);
        if (进度获取失败) {
          警告日志(`    注意: 进度获取失败标记仍存在，请手动检查`);
        }
        return null;
      }

      信息日志(`    执行: 当前进度 ${进度}/110，第 ${今日执行次数 + 1} 次尝试`);
      if (进度获取失败) {
        信息日志(`    注意: 上次进度获取失败，本次将重新获取进度`);
      }

      // 记录执行次数
      额外数据 = { 基础任务: true };
    }

    // 执行任务脚本
    const { spawn } = await import('child_process');

    return new Promise((resolve) => {
      const child = spawn('node', [脚本完整路径, ...执行参数], {
        cwd: path.dirname(脚本完整路径),
        stdio: 'inherit',
        windowsHide: true,
        detached: false
      });

      child.on('close', (code) => {
        if (code === 0) {
          成功日志(`    ✓ 账号 ${账号名称} 执行完成`);

          // 如果是每日任务，检查是否有进度获取失败的标记
          if (任务.名称 === '每日任务' && 额外数据) {
            // 读取任务记录，检查是否有进度获取失败的标记（任务脚本可能已经写入）
            const 记录 = 读取任务记录();
            const 今日记录 = 记录['每日任务']?.accounts?.[账号名称]?.dailyRecord || {};

            // 如果任务脚本已经标记了进度获取失败，更新额外数据
            if (今日记录.progressFetchFailed) {
              额外数据.progressFetchFailed = true;
              额外数据.progressFetchFailedReason = 今日记录.progressFetchFailedReason || '未知原因';
              警告日志(`    ⚠️ 检测到进度获取失败标记，已记录到任务记录`);
            }

            更新任务执行时间(任务.名称, 账号名称, true, 额外数据);
          } else {
            更新任务执行时间(任务.名称, 账号名称, true);
          }

          resolve(true);
        } else if (code === 2) {
          // ✅ 退出码2表示跳过（如6小时内已执行、能量不足、任务未启用等）
          信息日志(`    ○ 账号 ${账号名称} 已跳过（退出码: ${code}）`);
          // 不记录执行时间，下次检测时会重新尝试
          resolve(null); // 返回null表示跳过，区别于成功(true)和失败(false)
        } else if (code === 1) {
          // ⚠️ 退出码1表示执行失败，不应记录执行时间
          错误日志(`    ✗ 账号 ${账号名称} 执行失败，退出码: ${code}`);
          // 不记录执行时间，下次检测时会重新尝试
          resolve(false);
        } else {
          错误日志(`    ✗ 账号 ${账号名称} 执行失败，退出码: ${code}`);
          resolve(false);
        }
      });

      child.on('error', (error) => {
        错误日志(`    ✗ 账号 ${账号名称} 执行错误:`, error.message);
        更新任务执行时间(任务.名称, 账号名称, false);
        resolve(false);
      });
    });

  } catch (error) {
    错误日志(`    账号 ${账号名称} 执行失败:`, error.message);
    return false;
  }
}

// 检测并执行任务
async function 检测任务() {
  信息日志('');
  信息日志(`========== 任务检测 ${new Date().toLocaleString('zh-CN')} ==========`);

  // ===== 检查服务器维护时间（周五凌晨4:00-8:00）=====
  const 现在 = new Date();
  const 星期几 = 现在.getDay();
  const 当前小时 = 现在.getHours();

  if (星期几 === 5 && 当前小时 >= 4 && 当前小时 < 8) {
    警告日志('服务器维护中（周五 4:00-8:00），跳过任务');
    return;
  }

  // ===== 检查周末盐场活动时间（周六、周日 19:40-21:20）=====
  const 当前分钟 = 现在.getMinutes();
  const 当前时间分钟数 = 当前小时 * 60 + 当前分钟; // 转换为分钟数便于比较
  const 盐场开始时间 = 19 * 60 + 40; // 19:40 = 1180分钟
  const 盐场结束时间 = 21 * 60 + 20; // 21:20 = 1280分钟

  if ((星期几 === 6 || 星期几 === 0) && 当前时间分钟数 >= 盐场开始时间 && 当前时间分钟数 < 盐场结束时间) {
    const 星期名称 = 星期几 === 6 ? '周六' : '周日';
    警告日志(`周末盐场活动中（${星期名称} 19:40-21:20），暂停任务调度`);
    return;
  }

  // 检查并转换BIN文件（有变化才转换）
  await 检查并转换BIN();

  // 读取所有账号
  const tokens = 读取Tokens();

  if (tokens.length === 0) {
    警告日志('没有可用的Token');
    return;
  }

  信息日志(`共 ${tokens.length} 个账号`);

  // 按优先级排序
  const 排序任务 = [...任务列表].sort((a, b) => a.优先级 - b.优先级);

  let 执行计数 = 0;

  // 逐个检测任务模块
  for (const 任务 of 排序任务) {
    try {
      // ===== 竞技场任务：检查时间窗口 =====
      if (任务.名称 === '竞技场') {
        const 现在 = new Date();
        const 当前小时 = 现在.getHours();

        if (当前小时 < 8 || 当前小时 >= 22) {
          continue; // 静默跳过，不在开放时间
        }
      }

      // ===== 梦境任务：检查开放日 =====
      if (任务.名称 === '梦境') {
        const 现在 = new Date();
        const 星期几 = 现在.getDay();
        const 是开放日 = (星期几 === 0 || 星期几 === 1 || 星期几 === 3 || 星期几 === 4);
        if (!是开放日) {
          continue; // 静默跳过，不是开放日
        }
      }

      // ===== 宝库任务：检查开放日（周三至周日，周一周二不开放）=====
      if (任务.名称 === '宝库') {
        const 现在 = new Date();
        const 星期几 = 现在.getDay();
        const 是开放日 = (星期几 !== 1 && 星期几 !== 2);
        if (!是开放日) {
          continue; // 静默跳过，不是开放日
        }
      }

      // ===== 疯狂赛车任务：无时间窗口限制 =====
      if (任务.名称 === '疯狂赛车') {
        // 允许任何时候执行，由任务内部判断
      }

      let 模块执行计数 = 0;

      // 收集需要执行的账号
      const 需要执行的账号 = [];

      // 读取任务配置，检查是否启用
      const 任务配置 = 读取任务配置();

      for (let i = 0; i < tokens.length; i++) {
        const 账号名称 = tokens[i].name;

        // 检查账号是否启用该任务
        const 账号配置 = 任务配置.账号配置?.[账号名称];
        if (账号配置) {
          // 如果账号全局禁用，跳过该账号的所有任务
          if (账号配置.启用 === false) {
            // 信息日志(`  [账号: ${账号名称}] 账号已全局禁用`);
            continue;
          }

          // 根据任务名称检查开关
          // 任务开关默认值与前端保持一致
          // 大多数任务默认开启（!== false），只有月度补齐任务默认关闭（=== true）
          let 任务启用 = false;
          switch (任务.名称) {
            case '每日任务':
              任务启用 = 账号配置.每日任务?.启用 !== false;
              break;
            case '盐罐机器':
              任务启用 = 账号配置.盐罐机器?.启用 !== false;
              break;
            case '挂机奖励':
              任务启用 = 账号配置.挂机奖励?.启用 !== false;
              break;
            case 'BOSS战斗':
              任务启用 = 账号配置.BOSS战斗?.启用 !== false;
              break;
            case '咸将塔':
              任务启用 = 账号配置.咸将塔?.启用 !== false;
              break;
            case '竞技场':
              任务启用 = 账号配置.竞技场?.启用 !== false;
              break;
            case '俱乐部签到':
              任务启用 = 账号配置.俱乐部签到?.启用 !== false;
              break;
            case '咸鱼大冲关':
              任务启用 = 账号配置.咸鱼大冲关?.启用 !== false;
              break;
            case '疯狂赛车':
              任务启用 = 账号配置.疯狂赛车?.启用 !== false;
              break;
            case '每日咸王':
              // 每日咸王需要同时检查每日任务的总开关和每日咸王子开关
              const 每日任务启用 = 账号配置.每日任务?.启用 !== false;
              const 每日咸王启用 = 账号配置.每日咸王?.启用 !== false;
              任务启用 = 每日任务启用 && 每日咸王启用;
              break;
            case '军团商店购买':
              任务启用 = 账号配置.军团商店购买?.启用 !== false;
              break;
            case '梦境':
              任务启用 = 账号配置.梦境?.启用 !== false;
              break;
            case '宝库':
              任务启用 = 账号配置.宝库?.启用 !== false;
              break;
            case '灯神':
              任务启用 = 账号配置.灯神?.启用 !== false;
              break;
            case '黑市周购买':
              任务启用 = 账号配置.黑市周购买?.启用 !== false;
              break;
            case '竞技场月度补齐':
              // 竞技场月度补齐：默认关闭，需要手动开启
              任务启用 = 账号配置.竞技场?.月度补齐 === true;
              break;
            case '钓鱼月度补齐':
              // 钓鱼月度补齐：默认关闭，需要手动开启
              任务启用 = 账号配置.每日任务?.钓鱼月度补齐 === true;
              break;
            case '怪异塔':
              // 怪异塔：默认开启
              任务启用 = 账号配置.怪异塔?.启用 !== false;
              break;
            default:
              任务启用 = true; // 默认启用
          }

          if (!任务启用) {
            // 信息日志(`  [账号: ${账号名称}] 任务已关闭`);
            continue; // 跳过已关闭的任务
          }
        }

        const 上次执行时间 = 获取账号执行时间(任务.名称, 账号名称);

        // 每天执行，且未达到成功或最大次数
        const 需要执行 = (任务.名称 === '每日任务' || 任务.名称 === '咸鱼大冲关' || 任务.名称 === '疯狂赛车' || 任务.名称 === '每日咸王' || 任务.名称 === '军团商店购买' || 任务.名称 === '梦境' || 任务.名称 === '宝库' || 任务.名称 === '黑市周购买' || 任务.名称 === '竞技场月度补齐' || 任务.名称 === '钓鱼月度补齐' || 任务.名称 === '怪异塔')
          ? 任务.检测时间(上次执行时间, 账号名称)
          : 任务.检测时间(上次执行时间);

        if (需要执行) {
          需要执行的账号.push(账号名称);
        } else {
          // 不需要执行，显示详细信息
          if (任务.名称 === '梦境' && 上次执行时间) {
            // 梦境任务：显示周期信息
            const 上次时间 = new Date(上次执行时间);
            const 上次星期 = 上次时间.getDay();
            const 星期名 = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
            const 上次周期 = (上次星期 === 0 || 上次星期 === 1) ? '周日-周一' : '周三-周四';
            const 格式化时间 = 上次时间.toLocaleString('zh-CN', {
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit'
            });
            信息日志(`  [${账号名称}] 上次执行: ${格式化时间} (${星期名[上次星期]})  |跳过原因: 本周期(${上次周期})已执行`);
          } else if ((任务.名称 === '军团商店购买' || 任务.名称 === '咸鱼大冲关') && 上次执行时间) {
            // 军团商店购买、咸鱼大冲关：显示下周一
            const 上次时间 = 格式化时间(上次执行时间);
            const 现在 = new Date();
            const 星期几 = 现在.getDay();
            const 距离周一天数 = 星期几 === 0 ? 1 : (8 - 星期几); // 周日是1天，其他是8-星期几
            const 下周一 = new Date(现在);
            下周一.setDate(现在.getDate() + 距离周一天数);
            下周一.setHours(0, 0, 0, 0);
            const 下周一日期 = `${下周一.getMonth() + 1}/${下周一.getDate()}`;
            信息日志(`  [${账号名称}] 上次执行: ${上次时间}  |下次执行: 下周一(${下周一日期})`);
          } else {
            // 其他任务：显示常规信息
            const 上次时间 = 格式化时间(上次执行时间);
            const 剩余时间 = 计算剩余时间(上次执行时间, 任务.执行间隔);
            信息日志(`  [${账号名称}] 上次执行: ${上次时间}  |下次执行: ${剩余时间}后`);
          }
        }
      }

      // 如果有需要执行的账号，逐个执行
      if (需要执行的账号.length > 0) {
        信息日志(`  共 ${需要执行的账号.length} 个账号需要执行`);

        // 逐个执行，间隔5秒
        for (let i = 0; i < 需要执行的账号.length; i++) {
          const 账号名称 = 需要执行的账号[i];
          信息日志(`  └─ 执行: [账号${i + 1}/${需要执行的账号.length}: ${账号名称}]`);

          // 执行单个账号
          const 结果 = await 执行账号任务(任务, 账号名称);

          if (结果 === true) {
            // 不再累加总执行计数，只记录模块执行计数
            模块执行计数++;
          } else if (结果 === false) {
            错误日志(`    ✗ 账号 ${账号名称} 执行失败`);
          } else if (结果 === null) {
            // 跳过的情况已经在执行账号任务中记录了日志，这里不需要额外处理
          }

          // 账号间隔时间（除了最后一个）
          if (i < 需要执行的账号.length - 1) {
            信息日志(`    等待5秒后执行下一个账号...`);
            await new Promise(resolve => setTimeout(resolve, 5000));
          }
        }
      }

      if (模块执行计数 > 0) {
        成功日志(`✓ ${任务.名称} 完成 (${模块执行计数}个账号)`);
        await new Promise(resolve => setTimeout(resolve, 20000)); // 模块间隔20秒
      }

    } catch (error) {
      错误日志(`任务失败 ${任务.名称}:`, error.message);
    }
  }

  信息日志('检测完成');
}

// 读取Tokens
function 读取Tokens() {
  try {
    const tokensPath = path.join(__dirname, '../data/tokens.json');
    if (!fs.existsSync(tokensPath)) {
      return [];
    }
    return JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
  } catch (error) {
    错误日志('读取Tokens失败:', error.message);
    return [];
  }
}

// 主循环
async function 启动调度器() {
  信息日志('');
  信息日志('************************************************************');
  信息日志('*                                                          *');
  信息日志('*              游戏任务统一调度器已启动                     *');
  信息日志('*                                                          *');
  信息日志('*              检测间隔: 20秒（自然循环）                  *');
  信息日志('*              任务数量: ' + 任务列表.length + ' 个                                *');
  信息日志('*              执行方式: 逐个顺序执行                      *');
  信息日志('*              账号间隔: 5秒                              *');
  信息日志('*              模块间隔: 20秒                            *');
  信息日志('*              维护时间: 周五 4:00-8:00 暂停执行          *');
  信息日志('*              日志清理: 每天0点自动清理旧日志             *');
  信息日志('*              状态清理: 每日/每周/活动周自动清理          *');
  信息日志('*                                                          *');
  信息日志('************************************************************');
  信息日志('');

  // 立即执行一次检测
  await 检测任务();

  // 自然循环执行
  while (true) {
    // ✅ 授权校验 (异步获取，支持dist远程验证)
    const licenseStatus = await getLicenseStatus();
    if (!licenseStatus || !licenseStatus.authorized) {
      const machineId = licenseStatus?.machineId || getMachineId();
      警告日志(`[授权系统] 系统未授权或授权已过期，调度器等待中 (机器码: ${machineId})...`);
      // 每分钟检查一次
      await new Promise(resolve => setTimeout(resolve, 60000));
      continue;
    }
    try {
      const 现在 = new Date();
      const 当前日期 = `${现在.getFullYear()}-${String(现在.getMonth() + 1).padStart(2, '0')}-${String(现在.getDate()).padStart(2, '0')}`;
      const 当前小时 = 现在.getHours();
      const 当前分钟 = 现在.getMinutes();
      const 星期几 = 现在.getDay();

      // 检查是否是新的一天，执行每日清理
      if (上次状态清除日期 !== 当前日期) {
        信息日志('执行每日清理...');
        执行每日清理();

        // 检查活动周清理
        const 清理结果 = 执行活动周清理();
        if (清理结果 > 0) {
          成功日志(`活动周清理完成 (${清理结果}个账号)`);
        }

        // 周一执行每周清理
        if (星期几 === 1) {
          const 本周一日期 = 获取本周一日期();
          if (!上次每周清理日期 || 上次每周清理日期 < 本周一日期) {
            执行每周清理();
            成功日志('每周清理完成');
            上次每周清理日期 = 本周一日期;
            保存清理记录({
              lastDailyCleanupDate: 当前日期,
              lastWeeklyCleanupDate: 本周一日期,
              lastLogCleanupDate: 上次日志清理日期
            });
          }
        }

        上次状态清除日期 = 当前日期;
        保存清理记录({
          lastDailyCleanupDate: 当前日期,
          lastWeeklyCleanupDate: 上次每周清理日期,
          lastLogCleanupDate: 上次日志清理日期
        });
        成功日志('每日清理完成');
      } else {
        // 仍然检查活动周清理
        const 清理结果 = 执行活动周清理();
        if (清理结果 > 0) {
          成功日志(`活动周清理完成 (${清理结果}个账号)`);
        }

        // 周一检查每周清理
        if (星期几 === 1) {
          const 本周一日期 = 获取本周一日期();
          if (!上次每周清理日期 || 上次每周清理日期 < 本周一日期) {
            执行每周清理();
            成功日志('每周清理完成');
            上次每周清理日期 = 本周一日期;
            保存清理记录({
              lastDailyCleanupDate: 上次状态清除日期,
              lastWeeklyCleanupDate: 本周一日期,
              lastLogCleanupDate: 上次日志清理日期
            });
          }
        }
      }

      // 每天清理旧日志
      if (上次日志清理日期 !== 当前日期) {
        清理过期日志();
        上次日志清理日期 = 当前日期;
        保存清理记录({
          lastDailyCleanupDate: 上次状态清除日期,
          lastWeeklyCleanupDate: 上次每周清理日期,
          lastLogCleanupDate: 当前日期
        });
      }

      // 执行任务检测
      await 检测任务();
      await new Promise(resolve => setTimeout(resolve, 20000)); // 20秒
    } catch (error) {
      错误日志('调度器异常:', error.message);
      await new Promise(resolve => setTimeout(resolve, 60000)); // 1分钟
    }
  }
}

// 启动
启动调度器().catch(error => {
  错误日志('调度器异常:', error.message);
  process.exit(1);
});