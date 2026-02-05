/**
 * 游戏客户端 - 后端专用的WebSocket客户端封装
 * 用于工具箱等后端功能，与任务代码分离
 */

import WebSocket from 'ws';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { bon, getEnc } from '../工具/BON协议.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取配置
function getConfig() {
    const configPath = path.join(__dirname, '../config/config.json');
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

/**
 * 游戏客户端类
 */
export class GameClient {
    constructor(token) {
        this.token = token;
        this.ws = null;
        this.connected = false;
        this.seq = 0;
        this.ack = 0;
        this.heartbeatTimer = null;
        this.pendingRequests = new Map(); // 等待响应的请求
    }

    /**
     * 连接服务器
     */
    async connect() {
        const config = getConfig();
        const wsUrl = config.wsServer;
        
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (this.ws) this.ws.close();
                reject(new Error('连接超时'));
            }, 30000);

            const tokenParam = encodeURIComponent(this.token);
            const fullUrl = `${wsUrl}?p=${tokenParam}&e=x&lang=chinese`;

            this.ws = new WebSocket(fullUrl);

            this.ws.on('open', () => {
                clearTimeout(timeout);
                this.connected = true;
                this.startHeartbeat();
                resolve();
            });

            this.ws.on('message', (data) => this.handleMessage(data));

            this.ws.on('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });

            this.ws.on('close', () => {
                this.connected = false;
                this.stopHeartbeat();
            });
        });
    }

    /**
     * 处理消息
     */
    handleMessage(data) {
        try {
            const buffer = new Uint8Array(data);
            const enc = getEnc('auto');
            const decrypted = enc.decrypt(buffer);
            const message = bon.decode(decrypted);

            if (!message || typeof message !== 'object') return;

            if (message.seq) this.ack = message.seq;

            // 心跳响应
            if (message.cmd === '_sys/heartbeat') {
                this.sendHeartbeatAck();
                return;
            }
            if (message.cmd === '_sys/ack') return;

            // 处理响应
            this.handleResponse(message);
        } catch (error) {
            console.error('[GameClient] 消息解析失败:', error.message);
        }
    }

    /**
     * 处理响应，匹配等待的请求
     */
    handleResponse(message) {
        // 优先使用 resp 字段匹配（服务器返回的 resp 对应请求的 seq）
        if (message.resp !== undefined && this.pendingRequests.has(message.resp)) {
            const request = this.pendingRequests.get(message.resp);
            this.pendingRequests.delete(message.resp);
            clearTimeout(request.timer);

            // 解码body
            let responseBody = message.body;
            if (responseBody && typeof responseBody === 'object' && !Array.isArray(responseBody)) {
                const keys = Object.keys(responseBody);
                if (keys.length > 0 && keys.every(key => !isNaN(parseInt(key)))) {
                    try {
                        const bytes = new Uint8Array(Object.values(responseBody));
                        responseBody = bon.decode(bytes);
                    } catch (e) {}
                }
            }

            // 检查错误
            if (message.code && message.code !== 0) {
                request.reject(new Error(`服务器错误: ${message.code} - ${message.error || message.hint || '未知错误'}`));
            } else {
                request.resolve(responseBody || message);
            }
            return;
        }

        // 兼容旧的基于cmd的匹配方式
        const cmd = message.cmd;
        if (!cmd) return;

        // 响应命令映射
        const responseMap = {
            'Role_GetRoleInfoResp': 'role_getroleinfo',
            'role_getroleinforesp': 'role_getroleinfo',
            'Item_OpenBoxResp': 'item_openbox',
            'item_openboxresp': 'item_openbox',
            'Item_BatchClaimBoxPointRewardResp': 'item_batchclaimboxpointreward',
            'item_batchclaimboxpointrewardresp': 'item_batchclaimboxpointreward',
            'Artifact_LotteryResp': 'artifact_lottery',
            'artifact_lotteryresp': 'artifact_lottery',
            'Hero_RecruitResp': 'hero_recruit',
            'hero_recruitresp': 'hero_recruit',
            'SyncRewardResp': 'artifact_lottery',
            'syncrewardresp': 'artifact_lottery'
        };

        const originalCmd = responseMap[cmd] || responseMap[cmd.toLowerCase()] || cmd.toLowerCase().replace('resp', '');

        // 查找匹配的请求
        for (const [requestId, request] of this.pendingRequests) {
            if (request.cmd === originalCmd || request.cmd === cmd || request.cmd.toLowerCase() === originalCmd) {
                this.pendingRequests.delete(requestId);
                clearTimeout(request.timer);

                // 解码body
                let responseBody = message.body;
                if (responseBody && typeof responseBody === 'object' && !Array.isArray(responseBody)) {
                    const keys = Object.keys(responseBody);
                    if (keys.length > 0 && keys.every(key => !isNaN(parseInt(key)))) {
                        try {
                            const bytes = new Uint8Array(Object.values(responseBody));
                            responseBody = bon.decode(bytes);
                        } catch (e) {}
                    }
                }

                if (message.code && message.code !== 0) {
                    request.reject(new Error(`服务器错误: ${message.code} - ${message.error || '未知错误'}`));
                } else {
                    request.resolve(responseBody || message);
                }
                return;
            }
        }
    }

    /**
     * 发送命令并等待响应
     */
    async send(cmd, body = {}, timeout = 10000) {
        if (!this.connected) throw new Error('未连接');

        return new Promise((resolve, reject) => {
            // 使用seq作为请求ID，服务器会在响应中返回resp=seq
            this.seq++;
            const requestSeq = this.seq;

            const timer = setTimeout(() => {
                this.pendingRequests.delete(requestSeq);
                reject(new Error(`请求超时: ${cmd}`));
            }, timeout);

            this.pendingRequests.set(requestSeq, {
                cmd,
                resolve,
                reject,
                timer
            });

            this.sendRaw(cmd, body, requestSeq);
        });
    }

    /**
     * 发送原始消息（不等待响应）
     */
    sendRaw(cmd, body = {}, customSeq = null) {
        if (!this.connected || !this.ws || this.ws.readyState !== 1) {
            throw new Error('未连接');
        }

        const seq = customSeq !== null ? customSeq : ++this.seq;
        const encodedBody = bon.encode(body);
        const message = {
            cmd,
            seq,
            ack: this.ack,
            time: Date.now(),
            body: encodedBody
        };

        const encoded = bon.encode(message);
        const enc = getEnc('x');
        const encrypted = enc.encrypt(encoded);
        this.ws.send(encrypted);
    }

    /**
     * 获取角色信息
     */
    async getRoleInfo() {
        return await this.send('role_getroleinfo', {});
    }

    /**
     * 开启宝箱
     */
    async openBox(itemId, number) {
        return await this.send('item_openbox', { itemId, number });
    }

    /**
     * 领取宝箱积分
     */
    async claimBoxPoints() {
        return await this.send('item_batchclaimboxpointreward', {});
    }

    /**
     * 钓鱼
     */
    async fish(type, lotteryNumber) {
        return await this.send('artifact_lottery', { type, lotteryNumber, newFree: true });
    }

    /**
     * 招募
     */
    async recruit(recruitType, recruitNumber) {
        return await this.send('hero_recruit', { recruitType, recruitNumber, byClub: false });
    }

    // ==================== 盐罐机器人 ====================
    
    /**
     * 启动盐罐机器人
     */
    async startBottleHelper() {
        return await this.send('bottlehelper_start', {});
    }

    /**
     * 停止盐罐机器人
     */
    async stopBottleHelper() {
        return await this.send('bottlehelper_stop', {});
    }

    // ==================== 挂机相关 ====================

    /**
     * 分享回调（加钟）
     */
    async shareCallback(type = 2) {
        return await this.send('system_mysharecallback', { isSkipShareCard: true, type });
    }

    /**
     * 领取挂机奖励
     */
    async claimHangUpReward() {
        return await this.send('system_claimhangupreward', {});
    }

    // ==================== 竞技场 ====================

    /**
     * 开始竞技场
     */
    async startArena() {
        return await this.send('arena_startarea', {});
    }

    /**
     * 获取竞技场目标
     */
    async getArenaTarget() {
        return await this.send('arena_getareatarget', {});
    }

    /**
     * 竞技场战斗
     */
    async fightArena(targetId) {
        return await this.send('fight_startareaarena', { targetId });
    }

    // ==================== 升星相关 ====================

    /**
     * 英雄升星
     */
    async heroUpgradeStar(heroId) {
        return await this.send('hero_heroupgradestar', { heroId });
    }

    /**
     * 图鉴升星
     */
    async bookUpgrade(heroId) {
        return await this.send('book_upgrade', { heroId });
    }

    /**
     * 领取图鉴奖励
     */
    async claimBookReward() {
        return await this.send('book_claimpointreward', {});
    }

    // ==================== 武将升级 ====================

    /**
     * 武将升级
     */
    async heroUpgradeLevel(heroId, upgradeNum) {
        return await this.send('hero_heroupgradelevel', { heroId, upgradeNum });
    }

    /**
     * 武将进阶
     */
    async heroUpgradeOrder(heroId) {
        return await this.send('hero_heroupgradeorder', { heroId });
    }

    // ==================== 梦境相关 ====================

    /**
     * 获取预设队伍信息
     */
    async getPresetTeamInfo() {
        return await this.send('presetteam_getinfo', {});
    }

    /**
     * 选择梦境阵容
     */
    async selectDungeonHero(battleTeam) {
        return await this.send('dungeon_selecthero', { battleTeam });
    }

    /**
     * 梦境战斗
     */
    async fightDungeon(heroId) {
        return await this.send('fight_startdungeon', { heroId });
    }

    /**
     * 购买梦境商品
     */
    async buyDungeonMerchant(id, index, pos) {
        return await this.send('dungeon_buymerchant', { id, index, pos });
    }

    /**
     * 心跳
     */
    startHeartbeat() {
        this.heartbeatTimer = setInterval(() => {
            if (this.connected && this.ws && this.ws.readyState === 1) {
                this.sendHeartbeatPacket();
            }
        }, 3000);
    }

    sendHeartbeatPacket() {
        try {
            const message = { cmd: '_sys/ack', seq: 0, ack: this.ack, time: Date.now(), body: {} };
            const encoded = bon.encode(message);
            const enc = getEnc('x');
            const encrypted = enc.encrypt(encoded);
            this.ws.send(encrypted);
        } catch (e) {}
    }

    sendHeartbeatAck() {
        try {
            const message = { cmd: '_sys/ack', seq: this.seq, ack: this.ack, time: Date.now(), body: {} };
            const encoded = bon.encode(message);
            const enc = getEnc('x');
            const encrypted = enc.encrypt(encoded);
            this.ws.send(encrypted);
        } catch (e) {}
    }

    stopHeartbeat() {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    /**
     * 检查连接状态
     */
    isConnected() {
        return this.connected && this.ws && this.ws.readyState === 1;
    }

    /**
     * 断开连接
     */
    disconnect() {
        this.stopHeartbeat();
        this.pendingRequests.clear();
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
    }
}
