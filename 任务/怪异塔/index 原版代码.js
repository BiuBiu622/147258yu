/**
 * 怪异塔任务 - 主程序
 * 执行频率: 当能量充足时执行
 * 
 * 任务说明:
 * 怪异塔是一个爬塔挑战功能，消耗小鱼干能量不断挑战关卡
 * 支持连续失败保护、连接状态检测和重连、章节奖励领取
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { 创建WebSocket客户端 } from '../../工具/WebSocket客户端.js';
import { 成功日志, 错误日志, 警告日志, 信息日志 } from '../../工具/日志工具.js';
import { 更新账号记录 } from '../../工具/执行记录.js';
import { 获取账号配置, 任务是否启用 } from '../../工具/任务配置.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取配置
const 主配置 = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config/config.json'), 'utf-8'));
const 任务配置 = JSON.parse(fs.readFileSync(path.join(__dirname, './配置.json'), 'utf-8'));

// 层数格式转换
function 格式化层数(towerId) {
    if (towerId === 0) return '1-1';
    const chapter = Math.floor(towerId / 10) + 1;
    const floor = (towerId % 10) + 1;
    return `${chapter}-${floor}`;
}

// 执行怪异塔爬塔
async function 执行怪异塔(client, tokenData, 设置, 账号前缀 = '') {
    const prefix = 账号前缀 ? `${账号前缀} ` : '';
    let 胜利次数 = 0;
    let 失败次数 = 0;
    let 连续失败次数 = 0;
    const 连续失败阈值 = 设置.连续失败阈值 || 3;

    try {
        信息日志(`${prefix}━━━━━ 开始怪异塔挑战 ━━━━━`);

        // 1. 获取怪异塔信息
        信息日志(`${prefix}获取怪异塔信息...`);

        const towerInfoResp = await client.发送指令('evotower_getinfo', {}, '获取怪异塔信息', 15000);

        // ===== 调试日志 =====
        信息日志(`${prefix}[调试] 响应类型: ${typeof towerInfoResp}`);
        信息日志(`${prefix}[调试] 响应键: ${towerInfoResp ? Object.keys(towerInfoResp).join(', ') : 'null'}`);

        if (!towerInfoResp) {
            错误日志(`${prefix}未获取到怪异塔信息（响应为空）`);
            return { 胜利次数: 0, 失败次数: 0, 能量不足: true };
        }

        // 解析响应数据（兼容多种格式）
        let towerData = null;

        // 情况1: 响应直接就是 evoTower 数据
        if (towerInfoResp.evoTower) {
            towerData = towerInfoResp;
        }
        // 情况2: 响应有 body 字段
        else if (towerInfoResp.body) {
            towerData = towerInfoResp.body;
            // 如果 body 是 Uint8Array，需要解码
            if (towerData instanceof Uint8Array) {
                const { bon } = await import('../../工具/BON协议.js');
                towerData = bon.decode(towerData);
            }
        }
        // 情况3: 响应本身可能需要解码
        else if (towerInfoResp instanceof Uint8Array) {
            const { bon } = await import('../../工具/BON协议.js');
            towerData = bon.decode(towerInfoResp);
        }
        else {
            错误日志(`${prefix}怪异塔响应格式未知`);
            信息日志(`${prefix}[调试] 完整响应: ${JSON.stringify(towerInfoResp).substring(0, 200)}`);
            return { 胜利次数: 0, 失败次数: 0, 能量不足: true };
        }

        if (!towerData || !towerData.evoTower) {
            错误日志(`${prefix}怪异塔数据格式错误`);
            信息日志(`${prefix}[调试] towerData 键: ${towerData ? Object.keys(towerData).join(', ') : 'null'}`);
            return { 胜利次数: 0, 失败次数: 0, 能量不足: true };
        }

        let energy = towerData.evoTower.energy || 0;
        let towerId = towerData.evoTower.towerId || 0;

        if (energy <= 0) {
            警告日志(`${prefix}⚠️  小鱼干能量不足 (${energy})`);
            return { 胜利次数: 0, 失败次数: 0, 能量不足: true };
        }

        信息日志(`${prefix}当前层数: ${格式化层数(towerId)} (${towerId})`);
        信息日志(`${prefix}剩余能量: ${energy}`);
        信息日志('');

        // 2. 爬塔循环
        let 挑战次数 = 0;
        const 最大挑战次数 = 1000;
        let 已领取任务奖励 = false;  // 标志位，确保只领取一次

        while (energy > 0 && 挑战次数 < 最大挑战次数) {
            挑战次数++;

            信息日志(`${prefix}[挑战 ${挑战次数}] 当前层数: ${格式化层数(towerId)}, 能量: ${energy}`);

            try {
                // 准备战斗
                await client.发送指令('evotower_readyfight', {}, '准备战斗', 10000);

                // 等待200ms
                await new Promise(resolve => setTimeout(resolve, 200));

                // 开始战斗（添加必要参数）
                const fightResp = await client.发送指令('evotower_fight', {
                    battleNum: 1,
                    winNum: 1
                }, '执行战斗', 15000);

                if (!fightResp) {
                    throw new Error('战斗响应为空');
                }

                // 重置连续失败次数
                连续失败次数 = 0;

                // 解析战斗结果
                let fightData = fightResp.body || fightResp;
                if (fightData instanceof Uint8Array) {
                    const { bon } = await import('../../工具/BON协议.js');
                    fightData = bon.decode(fightData);
                }

                const evoTowerData = fightData.evoTower;
                const winListData = fightData.winList;

                // 更新能量
                let newEnergy = evoTowerData?.energy;
                if (newEnergy === undefined || newEnergy === null) {
                    newEnergy = Math.max(0, energy - 1);
                }
                energy = newEnergy;

                // 判断胜负
                let isWin = false;
                if (Array.isArray(winListData) && winListData.length > 0) {
                    isWin = winListData[0] === true;
                } else if (evoTowerData) {
                    // 如果有evoTower数据返回，默认认为胜利
                    isWin = true;
                }

                if (isWin) {
                    // 胜利
                    胜利次数++;
                    成功日志(`${prefix}✅ 第${挑战次数}次挑战胜利！`);

                    // 获取最新塔信息
                    const latestInfo = await client.发送指令('evotower_getinfo', {}, '获取最新塔信息', 10000);
                    const latestBody = latestInfo?.body || latestInfo;
                    const latestEvoTower = latestBody?.evoTower || latestBody;

                    if (latestEvoTower) {
                        const newTowerId = latestEvoTower.towerId || 0;
                        energy = latestEvoTower.energy || energy;

                        // 通关检测：层数个位变为1，表示进入新章节
                        if (newTowerId > towerId) {
                            const newFloor = (newTowerId % 10) + 1;
                            if (newFloor === 1) {
                                const chapter = Math.floor(towerId / 10);
                                信息日志(`${prefix}🎉 恭喜通关第 ${chapter} 章！正在领取奖励...`);
                                try {
                                    await client.发送指令('evotower_claimreward', {}, '领取章节奖励', 10000);
                                    成功日志(`${prefix}成功领取第 ${chapter} 章通关奖励`);

                                    // 领取奖励后重新获取能量
                                    const rewardInfo = await client.发送指令('evotower_getinfo', {}, '获取奖励后信息', 10000);
                                    const rewardEvoTower = (rewardInfo?.body || rewardInfo)?.evoTower;
                                    if (rewardEvoTower) {
                                        energy = rewardEvoTower.energy || energy;
                                    }
                                } catch (rewardError) {
                                    警告日志(`${prefix}领取奖励失败: ${rewardError.message}`);
                                }
                            }
                        }

                        towerId = newTowerId;
                        信息日志(`${prefix}当前层数: ${格式化层数(towerId)}`);
                    }
                } else {
                    // 失败
                    失败次数++;
                    警告日志(`${prefix}❌ 第${挑战次数}次挑战失败`);
                }

                // 等待400ms后继续下一次
                await new Promise(resolve => setTimeout(resolve, 400));

            } catch (error) {
                错误日志(`${prefix}挑战失败: ${error.message}`);
                失败次数++;
                连续失败次数++;

                if (连续失败次数 >= 连续失败阈值) {
                    警告日志(`${prefix}⚠️  连续失败${连续失败次数}次，停止挑战`);
                    break;
                }

                // 失败后尝试重新获取能量信息
                try {
                    const errorInfo = await client.发送指令('evotower_getinfo', {}, '获取失败后信息', 10000);
                    const errorEvoTower = (errorInfo?.body || errorInfo)?.evoTower;
                    if (errorEvoTower) {
                        energy = errorEvoTower.energy || 0;
                    }
                } catch (getInfoError) {
                    警告日志(`${prefix}重新获取塔信息失败: ${getInfoError.message}`);
                }

                if (energy <= 0) {
                    警告日志(`${prefix}能量耗尽，停止挑战`);
                    break;
                }

                // 失败后等待2秒
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        // 3. 领取任务奖励（挑战达到10次时执行，仅领取一次）
        if (挑战次数 >= 10 && !已领取任务奖励) {
            已领取任务奖励 = true;
            信息日志(`${prefix}开始领取怪异塔任务奖励...`);
            for (let taskId = 1; taskId <= 3; taskId++) {
                try {
                    await client.发送指令('evotower_claimtask', { taskId }, `领取任务奖励${taskId}`, 8000);
                    成功日志(`${prefix}领取任务奖励 taskId=${taskId} 成功`);
                } catch (taskError) {
                    警告日志(`${prefix}领取任务奖励 taskId=${taskId} 失败: ${taskError.message}`);
                }
                await new Promise(resolve => setTimeout(resolve, 800));
            }
            成功日志(`${prefix}任务奖励领取完成`);
        }

        // 输出统计
        信息日志('');
        信息日志(`${prefix}━━━━━ 挑战统计 ━━━━━`);
        信息日志(`${prefix}总挑战次数: ${挑战次数}`);
        信息日志(`${prefix}胜利: ${胜利次数} 次`);
        信息日志(`${prefix}失败: ${失败次数} 次`);
        信息日志(`${prefix}最终层数: ${格式化层数(towerId)}`);
        信息日志(`${prefix}剩余能量: ${energy}`);
        信息日志(`${prefix}━━━━━━━━━━━━━━━`);

        return { 胜利次数, 失败次数, 能量不足: energy <= 0 };

    } catch (error) {
        错误日志(`${prefix}怪异塔挑战失败: ${error.message}`);
        return { 胜利次数, 失败次数, 发生错误: true };
    }
}

// 单个账号执行函数
async function 执行单个账号(tokenData, 账号索引, 总账号数) {
    const 账号前缀 = `[账号${账号索引 + 1}/${总账号数}: ${tokenData.name}]`;
    const 开始时间 = Date.now();

    let client = null;

    try {
        信息日志(`${账号前缀} 正在连接...`);

        // 创建独立的 WebSocket 客户端实例
        client = 创建WebSocket客户端();

        // 连接
        await client.连接(tokenData.token);
        成功日志(`${账号前缀} 连接成功！`);

        // 等待连接稳定
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 获取账号配置
        const 账号配置 = 获取账号配置(tokenData.name, '怪异塔');
        const 设置 = 账号配置 || 任务配置.设置;

        // 执行怪异塔
        const 结果 = await 执行怪异塔(client, tokenData, 设置, 账号前缀);

        // 关闭连接
        client.断开连接();

        const 执行时长 = Math.round((Date.now() - 开始时间) / 1000);

        if (结果.能量不足) {
            警告日志(`${账号前缀} ⚠️  能量不足，无法挑战 (耗时: ${执行时长}秒)`);
            信息日志('');
            return {
                success: true,
                name: tokenData.name,
                winCount: 结果.胜利次数,
                loseCount: 结果.失败次数,
                noEnergy: true,
                duration: `${执行时长}秒`
            };
        } else if (结果.发生错误) {
            错误日志(`${账号前缀} ❌ 任务失败 (耗时: ${执行时长}秒)`);
            信息日志('');
            return {
                success: false,
                name: tokenData.name,
                error: '执行过程中发生错误',
                duration: `${执行时长}秒`
            };
        } else {
            成功日志(`${账号前缀} ✅ 任务完成 (耗时: ${执行时长}秒)`);
            信息日志('');
            return {
                success: true,
                name: tokenData.name,
                winCount: 结果.胜利次数,
                loseCount: 结果.失败次数,
                duration: `${执行时长}秒`
            };
        }

    } catch (error) {
        错误日志(`${账号前缀} 执行失败: ${error.message}`);
        if (client) {
            client.断开连接();
        }
        const 执行时长 = Math.round((Date.now() - 开始时间) / 1000);
        return {
            success: false,
            name: tokenData.name,
            error: error.message,
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

        if (指定账号) {
            // 单账号模式
            await 执行单个账号模式(指定账号);
        } else {
            // 全部账号模式
            await 执行全部账号模式(强制执行);
        }
    } catch (error) {
        错误日志('执行失败:', error.message);
        console.error(error);
        process.exit(1);
    }
}

// 单账号模式
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
    if (!任务是否启用(账号名称, '怪异塔')) {
        警告日志(`怪异塔任务未启用，跳过`);
        process.exit(0);
    }

    // 执行任务
    const result = await 执行单个账号(tokenData, 0, 1);

    // 保存账号记录
    更新账号记录(result.name, {
        status: result.success ? 'success' : 'failed',
        error: result.error || null,
        winCount: result.winCount || 0,
        loseCount: result.loseCount || 0,
        duration: result.duration || '0秒'
    });

    if (result.success) {
        成功日志('执行完成');
        process.exit(0);
    } else {
        错误日志(`执行失败: ${result.error}`);
        // 失败也返回0，避免调度器循环重试
        process.exit(0);
    }
}

// 全部账号模式
async function 执行全部账号模式(强制执行) {
    try {
        信息日志('='.repeat(60));
        信息日志('           怪异塔挑战任务');
        if (强制执行) {
            警告日志('           （强制执行模式）');
        }
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
        信息日志(`总计 ${tokens.length} 个账号`);
        信息日志('');

        // 顺序执行所有账号
        信息日志('开始顺序执行...');
        信息日志('');

        const results = [];
        let 总胜利次数 = 0;
        let 总失败次数 = 0;

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

            // 检查怪异塔任务是否启用
            if (!任务是否启用(accountName, '怪异塔')) {
                警告日志(`[账号${i + 1}/${tokens.length}: ${accountName}] 怪异塔任务未启用，跳过`);
                results.push({
                    success: false,
                    name: accountName,
                    error: '怪异塔任务未启用'
                });
                continue;
            }

            // 执行任务
            const result = await 执行单个账号(tokenData, i, tokens.length);
            results.push(result);

            if (result.winCount) {
                总胜利次数 += result.winCount;
            }
            if (result.loseCount) {
                总失败次数 += result.loseCount;
            }

            // 保存账号记录
            更新账号记录(result.name, {
                status: result.success ? 'success' : 'failed',
                error: result.error || null,
                winCount: result.winCount || 0,
                loseCount: result.loseCount || 0,
                duration: result.duration || '0秒'
            });

            // 账号间隔5秒
            if (i < tokens.length - 1) {
                信息日志('等待5秒后执行下一个账号...');
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }

        // 统计结果
        const 成功数 = results.filter(r => r.success).length;
        const 失败数 = results.filter(r => !r.success).length;

        信息日志('');
        信息日志('='.repeat(60));
        信息日志('执行统计:');
        信息日志(`  总账号数: ${tokens.length}`);
        信息日志(`  成功: ${成功数}`);
        信息日志(`  失败: ${失败数}`);
        信息日志(`  总胜利次数: ${总胜利次数}`);
        信息日志(`  总失败次数: ${总失败次数}`);
        信息日志('='.repeat(60));

        if (失败数 > 0) {
            信息日志('');
            信息日志('失败账号:');
            results.filter(r => !r.success).forEach(r => {
                信息日志(`  - ${r.name}: ${r.error}`);
            });
        }

        成功日志('怪异塔任务全部完成');
        process.exit(0);

    } catch (error) {
        错误日志('执行失败:', error.message);
        console.error(error);
        process.exit(1);
    }
}

// 运行主函数
main();
