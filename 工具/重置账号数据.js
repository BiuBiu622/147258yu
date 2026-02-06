/**
 * 完整重置所有账号配置和状态
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('========================================');
console.log('     完整重置所有账号配置和状态');
console.log('========================================');
console.log('');

// 1. 读取BIN文件列表（作为基准）
const binDir = path.join(__dirname, '../BIN文件');
const binFiles = fs.readdirSync(binDir).filter(f => f.endsWith('.bin'));
const accounts = binFiles.map(f => f.replace('.bin', '').trim());

console.log(`[步骤1] 读取BIN文件: ${accounts.length} 个`);
accounts.forEach((name, i) => console.log(`  ${i + 1}. ${name}`));
console.log('');

// 2. 完全清空account-status.json（重置所有账号状态）
const statusPath = path.join(__dirname, '../data/account-status.json');
const status = {};
fs.writeFileSync(statusPath, JSON.stringify(status, null, 2), 'utf-8');
console.log(`[步骤2] account-status.json已清空: 所有状态已重置`);
console.log('');

// 3. 重新生成task-config.json
const taskConfigPath = path.join(__dirname, '../data/task-config.json');

const defaultTaskConfig = {
    "启用": true,
    "付费招募": true,
    "领取挂机奖励": true,
    "开启宝箱": true,
    "领取盐罐": true,
    "领取邮件": true,
    "黑市购买": true,
    "购买清单": true,
    "手动购买": true
};

const defaultArenaConfig = {
    "启用": true,
    "竞技场阵容": 1,
    "战斗次数": 3
};

const defaultBossConfig = {
    "启用": true,
    "BOSS阵容": 1,
    "战斗次数": 3
};

const taskConfig = {
    "全局设置": {
        "启用任务调度": true,
        "自动更新Token": true,
        "日志保留天数": 30
    },
    "账号配置": {},
    "默认任务配置": {
        "每日任务": { ...defaultTaskConfig },
        "竞技场": { ...defaultArenaConfig },
        "BOSS战斗": { ...defaultBossConfig },
        "挂机奖励": { "启用": true },
        "盐罐机器": { "启用": true },
        "咸鱼大冲关": { "启用": true },
        "疯狂赛车": { "启用": true },
        "俱乐部签到": { "启用": true },
        "军团商店购买": { "启用": true }
    }
};

// 为每个账号生成配置
accounts.forEach(accountName => {
    taskConfig.账号配置[accountName] = {
        "启用": true,
        "每日任务": { ...defaultTaskConfig },
        "竞技场": { ...defaultArenaConfig },
        "BOSS战斗": { ...defaultBossConfig },
        "挂机奖励": { "启用": true },
        "盐罐机器": { "启用": true },
        "咸鱼大冲关": { "启用": true },
        "疯狂赛车": { "启用": true },
        "俱乐部签到": { "启用": true },
        "军团商店购买": { "启用": true }
    };
});

fs.writeFileSync(taskConfigPath, JSON.stringify(taskConfig, null, 2), 'utf-8');
console.log(`[步骤3] task-config.json已生成: ${Object.keys(taskConfig.账号配置).length} 个账号`);
console.log('');

// 4. 清空调度记录
const scheduleRecordPath = path.join(__dirname, '../data/task-schedule-record.json');
fs.writeFileSync(scheduleRecordPath, '{}', 'utf-8');
console.log(`[步骤4] task-schedule-record.json已清空`);
console.log('');

console.log('========================================');
console.log('     重置完成！');
console.log('========================================');
console.log('');
console.log(`✓ 账号数量: ${accounts.length}`);
console.log(`✓ 状态数据: 已完全清空`);
console.log(`✓ 任务配置: ${Object.keys(taskConfig.账号配置).length} 个`);
console.log(`✓ 调度记录: 已清空`);
console.log('');
console.log('重置内容:');
console.log('  - 所有账号状态归0（前台显示清空）');
console.log('  - 所有任务将重新执行');
console.log('  - 包含9个任务：每日、竞技场、BOSS、挂机、盐罐、冲关、赛车、签到、军团商店');
console.log('');
console.log('账号列表:');
accounts.forEach((name, i) => console.log(`  ${i + 1}. ${name}`));
console.log('');
