/**
 * 小号BOSS塔权限初始化脚本
 * 独立运行，不影响核心逻辑
 * 功能：为所有选中的小号执行一次每日咸王任务，解锁BOSS塔推荐队伍功能
 * 原理：直接读取BIN文件 -> 解析Token -> 连接WS -> 发送fight_startboss指令
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { WebSocketClient } from '../工具/WebSocket客户端.js';
import { bon } from '../工具/BON协议.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取主配置（获取认证服务器和WS服务器地址）
const globalConfigPath = path.join(__dirname, '../config/config.json');
let globalConfig = {
    authServer: "https://sg-cn-shanghai.xinyougames.com/token/get_token",
    wsServer: "wss://sg-cn-shanghai.xinyougames.com/websocket" // 默认值
};

if (fs.existsSync(globalConfigPath)) {
    try {
        const loadedConfig = JSON.parse(fs.readFileSync(globalConfigPath, 'utf-8'));
        // 合并配置，确保有默认值
        globalConfig = { ...globalConfig, ...loadedConfig };
    } catch (e) {
        console.error('读取主配置失败，使用默认值');
    }
}

// 添加外部logger支持
let customLogger = null;

// 日志函数
function log(type, message) {
    const time = new Date().toLocaleTimeString('zh-CN');
    const prefix = {
        'info': '[信息]',
        'success': '[成功]',
        'error': '[错误]',
        'warn': '[警告]'
    }[type] || '[信息]';

    // 控制台输出保留，方便服务端调试
    console.log(`[${time}] ${prefix} ${message}`);

    // 如果有外部logger，转发给它
    if (customLogger) {
        customLogger(type, message);
    }
}

// ... 加密解密函数不变 ...

// 导出主函数
export async function runInitTask(logger) {
    if (logger) {
        customLogger = logger;
    }

    log('info', '========== 开始初始化小号BOSS塔权限 (API模式) ==========');

    try {
        // 读取配置
        const configPath = path.join(__dirname, '配置.json');
        if (!fs.existsSync(configPath)) {
            throw new Error(`配置文件不存在: ${configPath}`);
        }

        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        const scoutNames = config.小号?.选中列表 || [];

        if (scoutNames.length === 0) {
            log('warn', '没有选中的小号，请先在配置中选择需要初始化的小号');
            return;
        }

        log('info', `即将在以下账号上执行每日咸王任务: ${scoutNames.join(', ')}`);

        let success = 0;
        let failed = 0;
        const failedAccounts = [];

        for (let i = 0; i < scoutNames.length; i++) {
            const scoutName = scoutNames[i];
            log('info', `[${i + 1}/${scoutNames.length}] 正在处理: ${scoutName}`);

            try {
                // 等待单个任务完成
                await executeTask(scoutName);
                success++;
                log('success', `✅ [${scoutName}] 初始化成功`);
            } catch (error) {
                failed++;
                failedAccounts.push(scoutName);
                log('error', `❌ [${scoutName}] 初始化失败: ${error.message}`);
            }

            // 延迟
            if (i < scoutNames.length - 1) {
                log('info', '等待 2 秒...');
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        log('info', '');
        log('info', '========================================');
        log('success', `初始化完成！`);
        log('info', `成功: ${success} 个`);
        if (failed > 0) {
            log('error', `失败: ${failed} 个 (${failedAccounts.join(', ')})`);
        }
        log('info', '========================================');

        // 移除 process.exit
        return { success: true, stats: { success, failed } };

    } catch (error) {
        log('error', `主程序错误: ${error.message}`);
        console.error(error);
        throw error; // 抛出错误供上层捕获
    }
}
// 移除 main() 自执行

function x解密(e) {
    const t = ((e[2] >> 6 & 1) << 7) | ((e[2] >> 4 & 1) << 6) | ((e[2] >> 2 & 1) << 5) | ((e[2] & 1) << 4) |
        ((e[3] >> 6 & 1) << 3) | ((e[3] >> 4 & 1) << 2) | ((e[3] >> 2 & 1) << 1) | (e[3] & 1);
    for (let n = e.length; --n >= 4;) e[n] ^= t;
    return e.subarray(4);
}

function 自动解密(data) {
    if (data.length > 4 && data[0] === 112 && data[1] === 120) {
        return x解密(data);
    }
    return data;
}

async function parseBinFile(binPath) {
    const binData = fs.readFileSync(binPath);
    const arrayBuffer = new Uint8Array(binData).buffer;

    const response = await axios.post(globalConfig.authServer, arrayBuffer, {
        params: { _seq: 1 },
        headers: {
            'Content-Type': 'application/octet-stream',
            'referrerPolicy': 'no-referrer'
        },
        responseType: 'arraybuffer'
    });

    const responseData = new Uint8Array(response.data);
    const decrypted = 自动解密(responseData);
    const parsed = bon.decode(decrypted);

    if (parsed.error) {
        throw new Error(parsed.error);
    }

    let authData = parsed;
    if (parsed.body && parsed.body instanceof Uint8Array) {
        authData = bon.decode(parsed.body);
    }

    if (!authData.roleToken || !authData.roleId) {
        throw new Error('认证响应中缺少roleToken或roleId');
    }

    const currentTime = Date.now();
    const token = {
        roleToken: authData.roleToken,
        roleId: authData.roleId,
        sessId: currentTime * 100 + Math.floor(Math.random() * 100),
        connId: currentTime + Math.floor(Math.random() * 10),
        isRestore: 0
    };

    return JSON.stringify(token);
}

// 获取今日BOSS ID
// 获取今日BOSS ID
function 获取今日BossId() {
    // 映射表：索引0-6对应周日到周六
    // 9901: 柴油兄弟
    // 9902: 落魄骑士
    // 9903: 齐天小圣
    // 9904: 畏尾鱼/癫颠蛙
    // 9905: 保包蛇
    const DAY_BOSS_MAP = [9904, 9905, 9901, 9902, 9903, 9904, 9905];
    const dayOfWeek = new Date().getDay();
    return DAY_BOSS_MAP[dayOfWeek];
}

// 执行单个小号的任务
async function executeTask(scoutName) {
    let wsClient = null;
    const binPath = path.join(__dirname, 'BIN文件/小号', `${scoutName}.bin`);

    if (!fs.existsSync(binPath)) {
        throw new Error(`BIN文件不存在: ${binPath}`);
    }

    try {
        log('info', `正在解析Token...`);
        const tokenJson = await parseBinFile(binPath);
        // 不需要解析JSON，因为WebSocketClient期望字符串格式的Token

        log('info', `正在连接服务器...`);
        wsClient = new WebSocketClient(globalConfig.wsServer, tokenJson);

        // 连接
        await wsClient.connect();

        // 延迟确保连接稳定
        await new Promise(resolve => setTimeout(resolve, 500));

        const bossId = 获取今日BossId();
        log('info', `发送每日咸王挑战指令 (BOSS ID: ${bossId})...`);

        // 发送指令并等待响应
        await new Promise((resolve, reject) => {
            let isResolved = false;
            const timeoutId = setTimeout(() => {
                if (!isResolved) {
                    isResolved = true;
                    reject(new Error('等待响应超时 (10s)'));
                }
            }, 10000);

            const messageHandler = (message) => {
                // 监听 Fight_StartBossResp 响应
                if (message.cmd === 'Fight_StartBossResp' || message.cmd === 'fight_startboss_resp') {
                    if (!isResolved) {
                        isResolved = true;
                        clearTimeout(timeoutId);

                        // 尝试解码 body
                        let body = message.body;
                        try {
                            // 检查是否为 encodable object (数字键)
                            if (body && typeof body === 'object' && !Array.isArray(body)) {
                                const keys = Object.keys(body);
                                if (keys.length > 0 && keys.every(key => !isNaN(parseInt(key)))) {
                                    const bytes = new Uint8Array(Object.values(body));
                                    body = bon.decode(bytes);
                                    // log('info', 'BON解码成功');
                                }
                            }
                        } catch (decodeError) {
                            log('warn', `解码失败: ${decodeError.message}`);
                        }

                        if (message.error) {
                            log('warn', `服务器返回错误: ${message.error}`);
                            reject(new Error(`服务器错误: ${message.error}`));
                        } else if (body) {
                            log('info', '========== 服务器原始响应数据 ==========');
                            try {
                                console.log(JSON.stringify(body, null, 2));
                            } catch (e) {
                                console.log('无法打印JSON');
                            }
                            log('info', '========================================');

                            // 强制转化为普通对象
                            try { body = JSON.parse(JSON.stringify(body)); } catch (e) { }

                            // 计算总伤害
                            let totalDamage = 0;
                            try {
                                // 兼容可能的 battleData 嵌套结构
                                const resultData = body.result || (body.battleData && body.battleData.result);

                                if (resultData) {
                                    // 方法1: 统计玩家所有英雄的伤害
                                    let sponsorDamage = 0;
                                    if (resultData.sponsor && resultData.sponsor.teamInfo) {
                                        sponsorDamage = resultData.sponsor.teamInfo.reduce((sum, hero) => sum + (hero.damage || 0), 0);
                                    }

                                    // 方法2: 直接读取BOSS受到的伤害
                                    let bossTakeDamage = 0;
                                    if (resultData.accept && resultData.accept.teamInfo) {
                                        bossTakeDamage = resultData.accept.teamInfo.reduce((sum, hero) => sum + (hero.takeDamage || 0), 0);
                                    }

                                    totalDamage = bossTakeDamage || sponsorDamage;
                                } else {
                                    log('warn', '未找到战斗结果数据 (result)');
                                }

                            } catch (e) {
                                log('warn', `计算伤害出错: ${e.message}`);
                            }

                            // 格式化伤害显示
                            const damageStr = (totalDamage / 100000000).toFixed(2) + '亿';
                            log('info', `本次挑战总伤害: ${damageStr} (${totalDamage})`);

                            // 判断伤害是否达标 (> 5亿)
                            if (totalDamage > 500000000) {
                                log('success', `✅ 伤害达标 (>5亿)，初始化成功！`);
                                resolve(body);
                            } else {
                                // 虽然不达标，但也算执行完成了，只是没达到预期效果
                                log('error', `❌ 伤害不足5亿，初始化未达到预期效果！`);
                                reject(new Error(`伤害不足5亿 (当前: ${damageStr})`));
                            }
                        } else {
                            resolve(message);
                        }
                    }
                }
            };
            // 注册消息监听
            wsClient.on('message', messageHandler);

            // 发送指令
            const success = wsClient.send('fight_startboss', { bossId });
            if (!success) {
                clearTimeout(timeoutId);
                reject(new Error('指令发送失败（WS未连接）'));
            }
        });

    } catch (error) {
        throw error;
    } finally {
        if (wsClient) {
            wsClient.disconnect();
            log('info', `连接已关闭`);
        }
    }
}

