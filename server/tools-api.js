/**
 * 工具箱API - 处理前端工具箱的请求
 * 使用后端专用的GameClient
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GameClient } from './game-client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 连接池 - 存储活跃的连接
const connections = new Map();

// 获取token数据
function getTokenData(accountName) {
    const tokensPath = path.join(__dirname, '../data/tokens.json');
    const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
    return tokens.find(t => t.name === accountName);
}

// 连接账号
async function connectAccount(accountName) {
    console.log(`[工具箱] 连接账号: ${accountName}`);
    
    // 检查是否已连接
    if (connections.has(accountName)) {
        const existing = connections.get(accountName);
        if (existing.client && existing.client.isConnected()) {
            console.log(`[工具箱] 账号 ${accountName} 已连接，获取最新信息`);
            try {
                const roleInfo = await existing.client.getRoleInfo();
                existing.roleInfo = roleInfo;
                existing.lastActivity = Date.now();
                return { success: true, message: '已连接', roleInfo };
            } catch (e) {
                console.log(`[工具箱] 获取信息失败，重新连接`);
            }
        }
        // 清理旧连接
        try { existing.client.disconnect(); } catch(e) {}
        connections.delete(accountName);
    }
    
    const tokenData = getTokenData(accountName);
    if (!tokenData) {
        return { success: false, error: '账号不存在' };
    }
    
    const client = new GameClient(tokenData.token);
    
    try {
        await client.connect();
        console.log(`[工具箱] 账号 ${accountName} 连接成功`);
        
        // 等待初始化
        await new Promise(r => setTimeout(r, 500));
        
        // 获取角色信息
        const roleInfo = await client.getRoleInfo();
        console.log(`[工具箱] 获取角色信息成功`);
        
        connections.set(accountName, {
            client,
            lastActivity: Date.now(),
            roleInfo
        });
        
        // 30分钟自动断开
        setTimeout(() => {
            if (connections.has(accountName)) {
                const conn = connections.get(accountName);
                if (Date.now() - conn.lastActivity > 30 * 60 * 1000) {
                    try { conn.client.disconnect(); } catch(e) {}
                    connections.delete(accountName);
                    console.log(`[工具箱] 账号 ${accountName} 超时断开`);
                }
            }
        }, 30 * 60 * 1000);
        
        return { success: true, roleInfo };
    } catch (error) {
        console.log(`[工具箱] 连接失败: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// 断开连接
function disconnectAccount(accountName) {
    if (connections.has(accountName)) {
        const conn = connections.get(accountName);
        try { conn.client.disconnect(); } catch(e) {}
        connections.delete(accountName);
    }
    return { success: true };
}

// 获取连接
function getClient(accountName) {
    if (!connections.has(accountName)) return null;
    const conn = connections.get(accountName);
    conn.lastActivity = Date.now();
    return conn.client;
}

// 获取角色信息
async function getRoleInfo(accountName) {
    const client = getClient(accountName);
    if (!client) return { success: false, error: '未连接' };
    
    try {
        const roleInfo = await client.getRoleInfo();
        if (connections.has(accountName)) {
            connections.get(accountName).roleInfo = roleInfo;
        }
        return { success: true, roleInfo };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// 开启宝箱
async function openBoxes(accountName, boxType, count) {
    const client = getClient(accountName);
    if (!client) return { success: false, error: '未连接' };
    
    try {
        const batches = Math.floor(count / 10);
        const remainder = count % 10;
        
        for (let i = 0; i < batches; i++) {
            await client.openBox(boxType, 10);
            await new Promise(r => setTimeout(r, 300));
        }
        
        if (remainder > 0) {
            await client.openBox(boxType, remainder);
            await new Promise(r => setTimeout(r, 300));
        }
        
        // 领取积分
        await client.claimBoxPoints();
        await new Promise(r => setTimeout(r, 300));
        
        // 获取最新信息
        const roleInfo = await client.getRoleInfo();
        return { success: true, roleInfo };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// 领取宝箱积分
async function claimBoxPoints(accountName) {
    const client = getClient(accountName);
    if (!client) return { success: false, error: '未连接' };
    
    try {
        await client.claimBoxPoints();
        await new Promise(r => setTimeout(r, 500));
        const roleInfo = await client.getRoleInfo();
        return { success: true, roleInfo };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// 钓鱼
async function fish(accountName, fishType, count) {
    const client = getClient(accountName);
    if (!client) return { success: false, error: '未连接' };
    
    try {
        const batches = Math.floor(count / 10);
        const remainder = count % 10;
        
        for (let i = 0; i < batches; i++) {
            await client.fish(fishType, 10);
            await new Promise(r => setTimeout(r, 350));
        }
        
        if (remainder > 0) {
            await client.fish(fishType, remainder);
            await new Promise(r => setTimeout(r, 350));
        }
        
        const roleInfo = await client.getRoleInfo();
        return { success: true, roleInfo };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// 招募
async function recruit(accountName, recruitType, count) {
    const client = getClient(accountName);
    if (!client) return { success: false, error: '未连接' };
    
    try {
        const batches = Math.floor(count / 10);
        const remainder = count % 10;
        
        for (let i = 0; i < batches; i++) {
            await client.recruit(recruitType, 10);
            await new Promise(r => setTimeout(r, 350));
        }
        
        if (remainder > 0) {
            await client.recruit(recruitType, remainder);
            await new Promise(r => setTimeout(r, 350));
        }
        
        const roleInfo = await client.getRoleInfo();
        return { success: true, roleInfo };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ==================== 盐罐机器人 ====================

// 启动盐罐
async function startBottle(accountName) {
    const client = getClient(accountName);
    if (!client) return { success: false, error: '未连接' };
    
    try {
        // 先停止再启动
        await client.stopBottleHelper();
        await new Promise(r => setTimeout(r, 300));
        await client.startBottleHelper();
        await new Promise(r => setTimeout(r, 300));
        const roleInfo = await client.getRoleInfo();
        return { success: true, roleInfo };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ==================== 挂机相关 ====================

// 加钟
async function extendHangUp(accountName) {
    const client = getClient(accountName);
    if (!client) return { success: false, error: '未连接' };
    
    try {
        // 加钟4次
        for (let i = 0; i < 4; i++) {
            await client.shareCallback(2);
            await new Promise(r => setTimeout(r, 300));
        }
        await new Promise(r => setTimeout(r, 500));
        const roleInfo = await client.getRoleInfo();
        return { success: true, roleInfo };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// 领取挂机奖励
async function claimHangUp(accountName) {
    const client = getClient(accountName);
    if (!client) return { success: false, error: '未连接' };
    
    try {
        await client.shareCallback();
        await new Promise(r => setTimeout(r, 200));
        await client.claimHangUpReward();
        await new Promise(r => setTimeout(r, 200));
        await client.shareCallback(2);
        await new Promise(r => setTimeout(r, 300));
        const roleInfo = await client.getRoleInfo();
        return { success: true, roleInfo };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ==================== 竞技场 ====================

// 竞技场战斗
async function arenaFight(accountName, count) {
    const client = getClient(accountName);
    if (!client) return { success: false, error: '未连接' };
    
    try {
        let successCount = 0;
        let failCount = 0;
        
        for (let i = 0; i < count; i++) {
            try {
                // 开始竞技场
                await client.startArena();
                await new Promise(r => setTimeout(r, 200));
                
                // 获取目标
                const targets = await client.getArenaTarget();
                const targetId = pickArenaTargetId(targets);
                
                if (!targetId) {
                    failCount++;
                    continue;
                }
                
                // 战斗
                await client.fightArena(targetId);
                successCount++;
                await new Promise(r => setTimeout(r, 300));
            } catch (e) {
                failCount++;
            }
        }
        
        const roleInfo = await client.getRoleInfo();
        return { success: true, roleInfo, successCount, failCount };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// 提取竞技场目标ID
function pickArenaTargetId(targets) {
    const candidate =
        targets?.rankList?.[0] ||
        targets?.roleList?.[0] ||
        targets?.targets?.[0] ||
        targets?.targetList?.[0] ||
        targets?.list?.[0];
    
    if (candidate?.roleId) return candidate.roleId;
    if (candidate?.id) return candidate.id;
    return targets?.roleId || targets?.id;
}

// ==================== 升星相关 ====================

// 英雄升星
async function heroUpgradeStar(accountName, delay = 300) {
    const client = getClient(accountName);
    if (!client) return { success: false, error: '未连接' };
    
    const heroIds = [
        ...Array.from({ length: 20 }, (_, i) => 101 + i),
        ...Array.from({ length: 28 }, (_, i) => 201 + i),
        ...Array.from({ length: 14 }, (_, i) => 301 + i)
    ];
    
    try {
        let done = 0;
        for (const heroId of heroIds) {
            for (let i = 0; i < 10; i++) {
                try {
                    const res = await client.heroUpgradeStar(heroId);
                    // 检查是否成功
                    const ok = res && (res.code === 0 || res.code === undefined || res.success === true || res.result === 0);
                    if (!ok) break; // 失败立即跳过，不延迟
                    // 成功后才延迟
                    await new Promise(r => setTimeout(r, delay));
                } catch (e) {
                    break; // 升星失败，跳过该英雄，不延迟
                }
            }
            done++;
        }
        
        const roleInfo = await client.getRoleInfo();
        return { success: true, roleInfo, done, total: heroIds.length };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// 图鉴升星
async function bookUpgrade(accountName, delay = 300) {
    const client = getClient(accountName);
    if (!client) return { success: false, error: '未连接' };
    
    const heroIds = [
        ...Array.from({ length: 20 }, (_, i) => 101 + i),
        ...Array.from({ length: 28 }, (_, i) => 201 + i),
        ...Array.from({ length: 14 }, (_, i) => 301 + i)
    ];
    
    try {
        let done = 0;
        for (const heroId of heroIds) {
            for (let i = 0; i < 10; i++) {
                try {
                    const res = await client.bookUpgrade(heroId);
                    const ok = res && (res.code === 0 || res.code === undefined || res.success === true || res.result === 0);
                    if (!ok) break;
                    await new Promise(r => setTimeout(r, delay));
                } catch (e) {
                    break;
                }
            }
            done++;
        }
        
        const roleInfo = await client.getRoleInfo();
        return { success: true, roleInfo, done, total: heroIds.length };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// 领取图鉴奖励
async function claimBookReward(accountName) {
    const client = getClient(accountName);
    if (!client) return { success: false, error: '未连接' };
    
    try {
        for (let i = 0; i < 10; i++) {
            try {
                await client.claimBookReward();
                await new Promise(r => setTimeout(r, 300));
            } catch (e) {
                break;
            }
        }
        
        const roleInfo = await client.getRoleInfo();
        return { success: true, roleInfo };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ==================== 消耗活动 ====================

// 打开活动道具
async function openActivityItem(accountName, count) {
    const client = getClient(accountName);
    if (!client) return { success: false, error: '未连接' };
    
    try {
        // 5261是普通活动道具ID
        await client.send('item_openpack', { itemId: 5261, index: 0, number: count });
        await new Promise(r => setTimeout(r, 300));
        const roleInfo = await client.getRoleInfo();
        return { success: true, roleInfo };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// 获取活动信息
async function getActivityInfo(accountName) {
    const client = getClient(accountName);
    if (!client) return { success: false, error: '未连接' };
    
    try {
        const activityInfo = await client.send('activity_get', {});
        return { success: true, activityInfo };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// ==================== 武将升级 ====================

// 武将升级
async function heroUpgradeLevel(accountName, heroId, upgradeNum) {
    const client = getClient(accountName);
    if (!client) return { success: false, error: '未连接' };
    
    try {
        await client.heroUpgradeLevel(heroId, upgradeNum);
        await new Promise(r => setTimeout(r, 300));
        const roleInfo = await client.getRoleInfo();
        return { success: true, roleInfo };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// 武将进阶
async function heroUpgradeOrder(accountName, heroId) {
    const client = getClient(accountName);
    if (!client) return { success: false, error: '未连接' };
    
    try {
        await client.heroUpgradeOrder(heroId);
        await new Promise(r => setTimeout(r, 300));
        const roleInfo = await client.getRoleInfo();
        return { success: true, roleInfo };
    } catch (error) {
        return { success: false, error: error.message };
    }
}

// 导出API
export const toolsApi = {
    connect: connectAccount,
    disconnect: disconnectAccount,
    getroleinfo: getRoleInfo,
    openbox: openBoxes,
    claimboxpoints: claimBoxPoints,
    fish: fish,
    recruit: recruit,
    // 盐罐
    startbottle: startBottle,
    // 挂机
    extendhangup: extendHangUp,
    claimhangup: claimHangUp,
    // 竞技场
    arenafight: arenaFight,
    // 升星
    heroupgradestar: heroUpgradeStar,
    bookupgrade: bookUpgrade,
    claimbookreward: claimBookReward,
    // 消耗活动
    openactivityitem: openActivityItem,
    getactivityinfo: getActivityInfo,
    // 武将升级
    heroupgradelevel: heroUpgradeLevel,
    heroupgradeorder: heroUpgradeOrder
};
