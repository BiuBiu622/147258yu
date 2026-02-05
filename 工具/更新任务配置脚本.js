/**
 * 更新任务配置脚本
 * 用于批处理文件调用
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const configFile = path.join(__dirname, '../data/task-config.json');
const tokensFile = path.join(__dirname, '../data/tokens.json');

// 读取配置
function readConfig() {
  return JSON.parse(fs.readFileSync(configFile, 'utf-8'));
}

// 保存配置
function saveConfig(config) {
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2), 'utf-8');
}

// 步骤1: 同步账号配置
async function step1() {
  console.log('[1/8] 同步账号配置，添加所有任务字段...');
  const { 同步账号配置 } = await import('./任务配置.js');
  同步账号配置();
  console.log('✓ 账号配置同步完成');
}

// 步骤2: 补全竞技场战斗次数配置
function step2() {
  console.log('[2/8] 补全竞技场战斗次数配置...');
  const config = readConfig();
  Object.keys(config.账号配置).forEach(name => {
    if (config.账号配置[name].竞技场 && !config.账号配置[name].竞技场.战斗次数) {
      config.账号配置[name].竞技场.战斗次数 = 3;
    }
  });
  if (config.默认任务配置?.竞技场 && !config.默认任务配置.竞技场.战斗次数) {
    config.默认任务配置.竞技场.战斗次数 = 3;
  }
  saveConfig(config);
  console.log('✓ 竞技场战斗次数已添加');
}

// 步骤3: 补全俱乐部签到配置
function step3() {
  console.log('[3/8] 补全俱乐部签到配置...');
  const config = readConfig();
  Object.keys(config.账号配置).forEach(name => {
    if (!config.账号配置[name].俱乐部签到) {
      config.账号配置[name].俱乐部签到 = { 启用: true };
    }
  });
  if (config.默认任务配置 && !config.默认任务配置.俱乐部签到) {
    config.默认任务配置.俱乐部签到 = { 启用: true };
  }
  saveConfig(config);
  console.log('✓ 俱乐部签到已添加');
}

// 步骤4: 补全梦境任务配置
function step4() {
  console.log('[4/8] 补全梦境任务配置...');
  const config = readConfig();
  Object.keys(config.账号配置).forEach(name => {
    if (!config.账号配置[name].梦境 || !config.账号配置[name].梦境.梦境阵容) {
      const 原启用状态 = config.账号配置[name].梦境?.启用 !== false;
      config.账号配置[name].梦境 = {
        启用: 原启用状态,
        梦境阵容: 1,
        自动战斗: false,
        购买金币商品: true,
        购买梦魇晶石: false
      };
    }
  });
  if (!config.默认任务配置.梦境 || !config.默认任务配置.梦境.梦境阵容) {
    const 原启用状态 = config.默认任务配置.梦境?.启用 !== false;
    config.默认任务配置.梦境 = {
      启用: 原启用状态,
      梦境阵容: 1,
      自动战斗: false,
      购买金币商品: true,
      购买梦魇晶石: false
    };
  }
  saveConfig(config);
  console.log('✓ 梦境任务配置已添加');
}

// 步骤5: 补全灯神任务配置
function step5() {
  console.log('[5/8] 补全灯神任务配置...');
  const config = readConfig();
  Object.keys(config.账号配置).forEach(name => {
    if (!config.账号配置[name].灯神) {
      config.账号配置[name].灯神 = { 启用: true };
    }
  });
  if (config.默认任务配置 && !config.默认任务配置.灯神) {
    config.默认任务配置.灯神 = { 启用: true };
  }
  saveConfig(config);
  console.log('✓ 灯神任务配置已添加');
}

// 步骤6: 补全咸将塔任务配置
function step6() {
  console.log('[6/8] 补全咸将塔任务配置...');
  const config = readConfig();
  Object.keys(config.账号配置).forEach(name => {
    if (!config.账号配置[name].咸将塔 || !config.账号配置[name].咸将塔.爬塔阵容) {
      const 原启用状态 = config.账号配置[name].咸将塔?.启用 !== false;
      config.账号配置[name].咸将塔 = {
        启用: 原启用状态,
        爬塔阵容: 1,
        最大小鱼干数: 10
      };
    }
  });
  if (!config.默认任务配置.咸将塔 || !config.默认任务配置.咸将塔.爬塔阵容) {
    const 原启用状态 = config.默认任务配置.咸将塔?.启用 !== false;
    config.默认任务配置.咸将塔 = {
      启用: 原启用状态,
      爬塔阵容: 1,
      最大小鱼干数: 10
    };
  }
  saveConfig(config);
  console.log('✓ 咸将塔任务配置已添加');
}

// 步骤7: 验证配置文件完整性
function step7() {
  console.log('[7/8] 验证配置文件完整性...');
  const config = readConfig();
  const tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf-8'));
  console.log('账号总数:', tokens.length);
  console.log('配置账号数:', Object.keys(config.账号配置).length);
  const firstAccount = Object.keys(config.账号配置)[0];
  console.log('示例账号:', firstAccount);
  const tasks = Object.keys(config.账号配置[firstAccount]).filter(k => k !== '启用');
  console.log('任务列表 (' + tasks.length + '个):');
  tasks.forEach(task => {
    const status = config.账号配置[firstAccount][task].启用 ? '✓' : '✗';
    console.log('  ' + status + ' ' + task);
  });
}

// 步骤8: 检查Web页面文件
function step8() {
  console.log('[8/8] 检查Web页面文件...');
  const webFile = path.join(__dirname, '../web/task-config.html');
  if (fs.existsSync(webFile)) {
    console.log('✓ Web配置页面存在');
    const html = fs.readFileSync(webFile, 'utf-8');
    const tasks = ['每日任务', '竞技场', 'BOSS战斗', '挂机奖励', '盐罐机器', '咸鱼大冲关', '疯狂赛车', '俱乐部签到', '军团商店购买', '每日咸王', '灯神', '梦境', '黑市周购买', '咸将塔'];
    console.log('Web页面支持的任务:');
    tasks.forEach(t => {
      if (html.includes(t)) {
        console.log('  ✓ ' + t);
      } else {
        console.log('  ✗ ' + t + ' (缺失)');
      }
    });
  } else {
    console.log('✗ Web配置页面不存在');
  }
}

// 主函数
async function main() {
  const step = process.argv[2];
  
  try {
    switch (step) {
      case '1':
        await step1();
        break;
      case '2':
        step2();
        break;
      case '3':
        step3();
        break;
      case '4':
        step4();
        break;
      case '5':
        step5();
        break;
      case '6':
        step6();
        break;
      case '7':
        step7();
        break;
      case '8':
        step8();
        break;
      default:
        console.log('用法: node 工具/更新任务配置脚本.js [1-8]');
        process.exit(1);
    }
  } catch (error) {
    console.error('错误:', error.message);
    process.exit(1);
  }
}

main();

