/**
 * BOSS塔助战 - 核心逻辑
 * 
 * 功能：
 * - 连接管理：多账号并发连接 + 心跳 + 断线重连
 * - 小号扫描：并发刷大厅，获取队伍ID
 * - 大号执行：收到队伍ID后加入队伍并助战
 * - 状态协调：小号发现ID通知大号，大号完成后通知小号继续
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { WebSocketClient } from '../工具/WebSocket客户端.js';
import { bon } from '../工具/BON协议.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 读取主配置
const 主配置 = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/config.json'), 'utf-8'));

// x解密
function x解密(e) {
  const t = ((e[2] >> 6 & 1) << 7) | ((e[2] >> 4 & 1) << 6) | ((e[2] >> 2 & 1) << 5) | ((e[2] & 1) << 4) |
    ((e[3] >> 6 & 1) << 3) | ((e[3] >> 4 & 1) << 2) | ((e[3] >> 2 & 1) << 1) | (e[3] & 1);
  for (let n = e.length; --n >= 4;) e[n] ^= t;
  return e.subarray(4);
}

// 自动解密
function 自动解密(data) {
  if (data.length > 4 && data[0] === 112 && data[1] === 120) {
    return x解密(data);
  }
  return data;
}

// 从BIN文件解析token
async function parseBinFile(binPath) {
  const binData = fs.readFileSync(binPath);
  const arrayBuffer = new Uint8Array(binData).buffer;

  const response = await axios.post(主配置.authServer, arrayBuffer, {
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


// 全局 seq 管理器（可选）
class SeqManager {
  constructor() {
    this.globalSeq = 1;
    this.connectionSeqs = new Map(); // 每个连接的独立seq
  }

  // 获取全局seq（跨连接唯一）
  getGlobalSeq() {
    return this.globalSeq++;
  }

  // 获取连接级别的seq（连接内唯一）
  getConnectionSeq(connectionId) {
    if (!this.connectionSeqs.has(connectionId)) {
      this.connectionSeqs.set(connectionId, 1);
    }
    const seq = this.connectionSeqs.get(connectionId);
    this.connectionSeqs.set(connectionId, seq + 1);
    return seq;
  }

  // 重置连接的seq（重连时调用）
  resetConnectionSeq(connectionId) {
    this.connectionSeqs.delete(connectionId);
  }
}

// 全局seq管理器实例
const seqManager = new SeqManager();

/**
 * 账号连接管理器
 * 管理单个账号的WebSocket连接、心跳、重连
 */
class AccountConnection {
  constructor(name, binPath, onLog) {
    this.name = name;
    this.binPath = binPath;
    this.onLog = onLog || (() => { });

    this.client = null;
    this.token = null;
    this.connected = false;
    this.roleInfo = null;

    // TOKEN缓存（24小时有效）
    this.cachedToken = null;
    this.tokenExpireTime = 0;

    // 连接唯一ID（用于seq管理）
    this.connectionId = `${name}_${Date.now()}`;

    // seq策略：使用连接级别的独立seq（推荐）
    // 如果需要全局唯一seq，可以改用 seqManager.getGlobalSeq()
    this.currentSeq = 1;
    this.pendingRequests = new Map();

    // 响应映射
    this.responseMap = {
      'BossTower_GetHallResp': 'bosstower_gethall',
      'BossTower_GetInfoResp': 'bosstower_getinfo',
      'Role_GetRoleInfoResp': 'role_getroleinfo',
      'MatchTeam_CreateResp': 'matchteam_create',
      'MatchTeam_LeaveResp': 'matchteam_leave',
      'Hero_CalcPowerByTeamResp': 'hero_calcpowerbyteam',
      'Team_SetTeamResp': 'team_setteam',
      'Fight_StartBossTowerResp': 'fight_startbosstower',
      'PresetTeam_GetInfoResp': 'presetteam_getinfo',
      'PresetTeam_SaveTeamResp': 'presetteam_saveteam'
    };
  }

  log(type, message) {
    this.onLog(type, `[${this.name}] ${message}`);
  }

  // 获取或刷新TOKEN（带缓存）
  async getToken() {
    const now = Date.now();

    // 检查缓存是否有效（24小时 = 86400000ms）
    if (this.cachedToken && now < this.tokenExpireTime) {
      this.log('info', '使用缓存TOKEN');
      return this.cachedToken;
    }

    // 缓存失效，重新解析BIN文件
    this.log('info', '正在解析BIN文件...');
    const token = await parseBinFile(this.binPath);

    // 缓存TOKEN，24小时后过期
    this.cachedToken = token;
    this.tokenExpireTime = now + 24 * 60 * 60 * 1000;  // 24小时

    return token;
  }

  // 连接
  async connect() {
    try {
      this.token = await this.getToken();

      this.log('info', '正在连接服务器...');
      this.client = new WebSocketClient(主配置.wsServer, this.token);

      // 消息监听
      this.client.on('message', (message) => this.handleMessage(message));
      this.client.on('disconnect', () => this.handleDisconnect());

      await this.client.connect();
      this.connected = true;
      this.log('success', '连接成功');

      // 停止心跳（外循环会定期断开重连，不再需要自动化心跳和超时检测）
      this.client.stopHeartbeat();
      this.client.stopTimeoutCheck();

      return true;
    } catch (error) {
      this.log('error', `连接失败: ${error.message}`);
      this.connected = false;
      return false;
    }
  }

  // 断开连接
  disconnect() {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
    this.connected = false;
    this.log('info', '已断开连接');
  }

  // 处理消息
  handleMessage(message) {
    const ack = message.ack;
    const cmd = message.cmd;

    // 通过ack匹配
    if (ack && ack > 0 && this.pendingRequests.has(ack)) {
      const pending = this.pendingRequests.get(ack);
      clearTimeout(pending.timeoutId);
      this.pendingRequests.delete(ack);
      pending.resolve(message);
      return;
    }

    // 通过cmd匹配
    if (cmd && this.responseMap[cmd]) {
      const originalCmd = this.responseMap[cmd];
      for (const [seq, pending] of this.pendingRequests.entries()) {
        if (pending.cmd === originalCmd) {
          clearTimeout(pending.timeoutId);
          this.pendingRequests.delete(seq);
          pending.resolve(message);
          return;
        }
      }
    }
  }

  // 处理断连
  handleDisconnect() {
    this.connected = false;
    this.log('warn', '连接已断开');
  }

  // 发送命令
  async sendCommand(cmd, body = {}, timeout = 15000) {
    if (!this.connected || !this.client) {
      return null;
    }

    // 使用连接级别的独立seq（推荐）
    const seq = this.currentSeq++;

    // 如果需要全局唯一seq，可以使用：
    // const seq = seqManager.getGlobalSeq();

    // 如果需要连接级别但由管理器统一管理，可以使用：
    // const seq = seqManager.getConnectionSeq(this.connectionId);

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(seq);
        resolve(null);
      }, timeout);

      this.pendingRequests.set(seq, { resolve, timeoutId, cmd });
      this.client.send(cmd, { ...body, seq });
    });
  }

  // 解析响应
  parseResponse(response) {
    if (!response) return null;
    if (response.error) return { error: response.error };

    let data = response.body;
    if (data instanceof Uint8Array) {
      data = bon.decode(data);
    }
    return data;
  }

  // 检查连接
  isConnected() {
    return this.connected && this.client && this.client.isConnected();
  }

  // 重连
  async reconnect() {
    this.disconnect();

    // 重置seq（重连后从1开始）
    this.currentSeq = 1;

    // 如果使用全局seq管理器，可以重置连接seq：
    // seqManager.resetConnectionSeq(this.connectionId);

    // 生成新的连接ID
    this.connectionId = `${this.name}_${Date.now()}`;

    await this.sleep(1000);
    return await this.connect();
  }

  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}


/**
 * BOSS塔助战核心类
 */
export class BossAssistCore {
  constructor() {
    // 状态
    this.running = false;
    this.scanning = false;
    this.masterExecuting = false;

    // 连接
    this.masterConn = null;      // 大号连接
    this.scoutConns = [];        // 小号连接列表

    // 多大号管理
    this.masterList = [];        // 大号列表
    this.currentMasterIndex = 0; // 当前大号索引
    this.masterRemainCounts = {}; // 每个大号的剩余次数 { "账号名": 19 }
    this.masterStats = {};       // 每个大号的统计数据 { "账号名": { total: 0, success: 0, fail: 0 } }

    // 配置
    this.config = null;
    this.masterFormationId = null; // 大号阵容编号（1-5）

    // 阵容缓存
    this.masterFormationCache = {}; // 每个大号的阵容缓存 { "账号名": {"0": 113, "1": 112, ...} }

    // 统计
    this.assistCount = 0;        // 助战次数
    this.lastTeamId = null;      // 最后处理的队伍ID
    this.floorStats = {};        // 层数统计 { "1": 5, "13": 10, ... }

    // 僵尸房间过滤
    this.teamFullCount = new Map();  // 记录每个队伍ID的"人数已满"次数
    this.blockedTeams = new Set();   // 被永久过滤的队伍ID黑名单

    // 回调
    this.onLog = null;
    this.onStatusChange = null;

    // 实时循环控制
    this.realtimeLoopRunning = false;
  }

  // 日志
  log(type, message) {
    const time = new Date().toLocaleTimeString('zh-CN');
    console.log(`[${time}] [${type.toUpperCase()}] ${message}`);
    if (this.onLog) {
      this.onLog(type, message);
    }
  }

  // 加载配置
  loadConfig() {
    const configPath = path.join(__dirname, '配置.json');
    this.config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    // 加载统计缓存
    this.loadStatsCache();

    return this.config;
  }

  // 加载统计缓存
  loadStatsCache() {
    const cachePath = path.join(__dirname, '统计缓存.json');
    try {
      if (fs.existsSync(cachePath)) {
        const cache = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        this.masterStats = cache.masterStats || {};
        this.masterRemainCounts = cache.masterRemainCounts || {};
        this.log('info', '已加载统计缓存');
      }
    } catch (e) {
      this.log('warn', `加载统计缓存失败: ${e.message}`);
      this.masterStats = {};
      this.masterRemainCounts = {};
    }
  }

  // 保存统计缓存
  saveStatsCache() {
    const cachePath = path.join(__dirname, '统计缓存.json');
    try {
      const cache = {
        masterStats: this.masterStats,
        masterRemainCounts: this.masterRemainCounts,
        lastUpdate: new Date().toISOString()
      };
      fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
    } catch (e) {
      this.log('warn', `保存统计缓存失败: ${e.message}`);
    }
  }

  // 保存配置
  saveConfig(newConfig) {
    const configPath = path.join(__dirname, '配置.json');
    this.config = { ...this.config, ...newConfig };
    fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  // 获取选中的小号BIN文件列表
  getSelectedScoutBinFiles() {
    const selectedList = this.config?.小号?.选中列表 || [];
    if (selectedList.length === 0) {
      return [];
    }

    const binDir = path.join(__dirname, 'BIN文件/小号');
    if (!fs.existsSync(binDir)) {
      return [];
    }

    return selectedList
      .map(name => ({
        name,
        path: path.join(binDir, `${name}.bin`)
      }))
      .filter(item => fs.existsSync(item.path));
  }

  // 获取大号BIN文件列表
  getMasterBinFiles() {
    const binDir = path.join(__dirname, 'BIN文件/大号');
    if (!fs.existsSync(binDir)) {
      return [];
    }

    const files = fs.readdirSync(binDir);
    return files
      .filter(f => f.endsWith('.bin'))
      .map(f => ({
        name: f.replace('.bin', ''),
        path: path.join(binDir, f)
      }));
  }

  // 获取选中的大号列表
  getSelectedMasterBinFiles() {
    const selectedList = this.config?.大号?.选中列表 || [];
    if (selectedList.length === 0) {
      return [];
    }

    const binDir = path.join(__dirname, 'BIN文件/大号');
    if (!fs.existsSync(binDir)) {
      return [];
    }

    return selectedList
      .map(name => ({
        name,
        path: path.join(binDir, `${name}.bin`)
      }))
      .filter(item => fs.existsSync(item.path));
  }

  // 获取大号BIN文件路径（已废弃，保留兼容）
  getMasterBinPath() {
    if (!this.config?.大号?.账号名称) {
      return null;
    }

    const binDir = path.join(__dirname, 'BIN文件/大号');
    const binPath = path.join(binDir, `${this.config.大号.账号名称}.bin`);

    if (fs.existsSync(binPath)) {
      return binPath;
    }

    return null;
  }

  // 启动
  async start() {
    if (this.running) {
      this.log('warn', '已经在运行中');
      return false;
    }

    this.log('info', '========== BOSS塔助战启动 ==========');

    // 加载配置
    this.loadConfig();

    // 清空统计数据（每次启动重新计数）
    this.masterStats = {};
    this.masterRemainCounts = {};
    this.masterFormationCache = {};  // 清空阵容缓存
    this.assistCount = 0;
    this.floorStats = {};
    this.log('info', '统计数据已重置');

    // 准备大号列表
    const masterBins = this.getSelectedMasterBinFiles();
    if (masterBins.length === 0) {
      this.log('error', '未选择大号或大号BIN文件不存在');
      return false;
    }

    this.masterList = masterBins;
    this.currentMasterIndex = 0;
    this.log('info', `选中 ${this.masterList.length} 个大号`);
    this.masterList.forEach((m, i) => {
      const formation = this.config.大号?.阵容配置?.[m.name] || '默认';
      this.log('info', `  ${i + 1}. ${m.name} (阵容: ${formation})`);
    });

    // 准备小号连接（不立即连接，等外循环）
    const scoutBins = this.getSelectedScoutBinFiles();
    if (scoutBins.length === 0) {
      this.log('warn', '没有选中的小号，仅大号模式');
    } else {
      this.log('info', `选中 ${scoutBins.length} 个小号`);

      for (const bin of scoutBins) {
        const conn = new AccountConnection(
          bin.name,
          bin.path,
          (type, msg) => this.log(type, msg)
        );
        this.scoutConns.push(conn);
      }
    }

    this.running = true;
    this.notifyStatusChange();

    // 开始实时扫描循环（外循环会统一连接大号和小号）
    this.startRealtimeLoop();

    return true;
  }

  // 停止
  async stop() {
    this.log('info', '正在停止...');

    this.running = false;
    this.scanning = false;
    this.realtimeLoopRunning = false;

    // 等待实时循环结束
    await this.sleep(1000);

    // 断开大号
    if (this.masterConn) {
      this.masterConn.disconnect();
      this.masterConn = null;
    }

    // 断开小号
    for (const conn of this.scoutConns) {
      conn.disconnect();
    }
    this.scoutConns = [];

    this.notifyStatusChange();
    this.log('info', '已停止');

    return true;
  }

  // 开始实时扫描循环（外循环+内循环架构）
  async startRealtimeLoop() {
    if (!this.running) return;

    this.realtimeLoopRunning = true;
    this.scanning = true;

    this.log('info', '========== 开始实时扫描循环 ==========');

    let 轮次 = 0;
    const 每轮扫描次数 = 20;  // 每轮最多扫描20次
    const 扫描间隔 = 2500;    // 2.5秒
    const 轮次间隔 = 3000;    // 3秒冷却

    // 外循环：连接 → 内循环 → 断开 → 冷却 → 重连
    while (this.realtimeLoopRunning && this.running) {
      try {
        轮次++;

        // 检查当前大号是否还有剩余次数
        const currentMaster = this.masterList[this.currentMasterIndex];
        if (!currentMaster) {
          this.log('error', '没有可用的大号');
          break;
        }

        this.log('info', `========== 第${轮次}轮开始 (大号: ${currentMaster.name}) ==========`);

        // 1. 连接所有账号（大号+小号）并检查剩余次数
        const remainCount = await this.connectAllScoutsAndCheckMaster();

        if (remainCount === null) {
          this.log('error', '无法获取剩余次数，跳过本轮');
          await this.sleep(轮次间隔);
          continue;
        }

        if (remainCount <= 0) {
          this.log('warn', `大号 ${currentMaster.name} 剩余次数为 ${remainCount}，已完成`);

          // 切换到下一个大号
          this.currentMasterIndex++;

          if (this.currentMasterIndex >= this.masterList.length) {
            this.log('success', '========== 所有大号已完成，任务结束 ==========');
            this.running = false;
            this.realtimeLoopRunning = false;
            break;
          }

          const nextMaster = this.masterList[this.currentMasterIndex];
          this.log('info', `切换到下一个大号: ${nextMaster.name}`);

          // 断开当前连接
          this.disconnectAllScouts();

          // 等待后继续下一轮
          await this.sleep(轮次间隔);
          continue;
        }

        this.log('info', `剩余助战次数: ${remainCount}`);
        this.notifyStatusChange();

        // 2. 内循环：扫描N次，找到队伍就立即停止
        let 找到队伍 = false;
        for (let i = 1; i <= 每轮扫描次数; i++) {
          if (!this.realtimeLoopRunning || !this.running) break;

          // 检查大号连接状态
          if (!this.masterConn.isConnected()) {
            this.log('warn', '大号连接已断开，停止本轮扫描');
            break;
          }

          this.log('info', `--- 第${i}次扫描 ---`);

          // 每 2 次扫描，主动给大号发个包保持连接并检查状态 (用户提议)
          if (i > 1 && i % 2 === 0) {
            this.log('info', `执行第 ${i} 次扫描前的连接保活检查...`);
            if (this.masterConn && this.masterConn.isConnected()) {
              this.masterConn.client.sendHeartbeatPacket();
            } else {
              this.log('warn', '大号连接在大号保活检查中被发现已断开');
              break;
            }
          }

          // 并发扫描所有小号（错开请求）
          const freshTeam = await this.scanAllScoutsConcurrently();

          if (freshTeam) {
            // 检查层数过滤
            if (this.checkFloorFilter(freshTeam)) {
              找到队伍 = true;

              // 立即战斗
              const result = await this.executeAssist(freshTeam);

              // 根据结果决定是否继续扫描
              if (result.success) {
                // 战斗成功，停止内循环，回到外循环
                this.log('info', '战斗完成，停止本轮扫描');
                break;
              } else if (result.shouldBreakRound) {
                // 大号断开，立即停止本轮
                this.log('info', '大号断开，立即进入外循环重连');
                break;
              } else if (result.shouldContinue) {
                // 队伍已满，继续扫描下一个队伍
                this.log('info', '继续扫描下一个队伍...');
                找到队伍 = false;  // 重置标志，继续扫描
              } else {
                // 其他错误，停止本轮扫描
                this.log('info', '战斗失败，停止本轮扫描');
                break;
              }
            } else {
              this.log('info', `跳过队伍 name: ${freshTeam.name}, ID: ${freshTeam.teamId}, 层数: ${freshTeam.towerId} (不符合过滤条件)`);
            }
          }

          // 扫描间隔（2.5秒）
          if (i < 每轮扫描次数) {
            await this.sleep(扫描间隔);
          }
        }

        if (!找到队伍) {
          this.log('info', `本轮扫描${每轮扫描次数}次，未发现符合条件的队伍`);
        }

        // 3. 断开所有账号（大号+小号）
        this.disconnectAllScouts();

        this.log('info', `========== 第${轮次}轮结束 ==========`);

        // 4. 轮次间隔（10秒冷却）
        if (this.realtimeLoopRunning && this.running) {
          this.log('info', `等待${轮次间隔 / 1000}秒后开始下一轮...`);
          await this.sleep(轮次间隔);
        }

      } catch (error) {
        this.log('error', `实时循环出错: ${error.message}`);
        await this.sleep(1000);
      }
    }

    this.scanning = false;
    this.log('info', '实时扫描循环已停止');
  }

  // 连接所有账号（大号+小号）并检查大号剩余次数
  async connectAllScoutsAndCheckMaster() {
    this.log('info', '开始连接所有账号...');

    // 1. 先连接大号并检查剩余次数
    const currentMaster = this.masterList[this.currentMasterIndex];

    // 创建或重用大号连接
    if (!this.masterConn || this.masterConn.name !== currentMaster.name) {
      if (this.masterConn) {
        this.masterConn.disconnect();
      }
      this.masterConn = new AccountConnection(
        currentMaster.name,
        currentMaster.path,
        (type, msg) => this.log(type, msg)
      );
    }

    if (!this.masterConn.isConnected()) {
      await this.masterConn.connect();
      await this.sleep(500);
    }

    // 获取BOSS塔信息，检查剩余次数
    this.log('info', '正在获取剩余助战次数...');
    const infoResp = await this.masterConn.sendCommand('bosstower_getinfo', {}, 5000);
    const infoData = this.masterConn.parseResponse(infoResp);

    let remainCount = null;
    if (infoData && infoData.bossTower) {
      remainCount = infoData.bossTower.remainHelpCnt;
      if (remainCount !== undefined && remainCount !== null) {
        this.masterRemainCounts[currentMaster.name] = remainCount;

        // 保存缓存
        this.saveStatsCache();
      }
    }

    // 获取并缓存当前大号的阵容
    if (!this.masterFormationCache[currentMaster.name]) {
      this.log('info', '正在获取阵容配置...');

      // 读取配置的阵容编号
      const formationConfig = this.config.大号?.阵容配置?.[currentMaster.name];
      let formationId = 1;  // 默认阵容1

      if (formationConfig && formationConfig !== '默认') {
        // 支持数字类型(3)和字符串类型("阵容3")
        if (typeof formationConfig === 'number') {
          formationId = formationConfig;
        } else if (typeof formationConfig === 'string') {
          const match = formationConfig.match(/阵容(\d+)/);
          if (match) {
            formationId = parseInt(match[1]);
          }
        }
      }

      // 获取阵容英雄ID
      const heroIds = await this.getFormationHeroIds(this.masterConn, formationId);

      if (heroIds) {
        this.masterFormationCache[currentMaster.name] = heroIds;
        this.log('success', `阵容${formationId}已缓存: ${Object.values(heroIds).join(', ')}`);
      } else {
        this.log('error', '获取阵容失败');
        return null;  // 获取失败，停止本轮
      }
    } else {
      this.log('info', `使用缓存的阵容: ${Object.values(this.masterFormationCache[currentMaster.name]).join(', ')}`);
    }

    // 2. 再连接小号（错开连接）
    for (let i = 0; i < this.scoutConns.length; i++) {
      const conn = this.scoutConns[i];

      if (!conn.isConnected()) {
        await conn.connect();
      }

      // 错开连接，避免同时连接
      if (i < this.scoutConns.length - 1) {
        await this.sleep(500);
      }
    }

    // 连接后等待稳定
    this.log('info', '等待连接稳定...');
    await this.sleep(1000);  // 1秒即可

    return remainCount;
  }

  // 连接所有账号（大号+小号）- 旧版本，保留兼容
  async connectAllScouts() {
    return await this.connectAllScoutsAndCheckMaster();
  }

  // 断开所有账号（大号+小号）
  disconnectAllScouts() {
    this.log('info', '断开所有账号...');

    // 断开大号
    if (this.masterConn) {
      this.masterConn.disconnect();
    }

    // 断开小号
    for (const conn of this.scoutConns) {
      conn.disconnect();
    }
  }

  // 并发扫描所有小号（错开请求避免限流）
  async scanAllScoutsConcurrently() {
    if (this.scoutConns.length === 0) {
      // 没有小号，大号自己扫描
      if (this.masterConn) {
        return await this.scanSingleScout(this.masterConn);
      }
      return null;
    }

    // 创建所有小号的扫描Promise（错开1秒，避免并发触发限流）
    // 根据IP限制分析：80次/分钟，3个账号需要错开请求
    const scanPromises = this.scoutConns.map((conn, index) =>
      new Promise(async (resolve) => {
        // 每个小号错开1秒（1000ms），避免同时请求
        // 3个小号：0ms, 1000ms, 2000ms
        await this.sleep(index * 1000);
        const result = await this.scanSingleScout(conn);
        resolve(result);
      })
    );

    // Promise.all: 等待所有小号扫描完成
    const results = await Promise.all(scanPromises);

    // 返回第一个有效结果
    return results.find(team => team !== null) || null;
  }

  // 扫描单个小号
  async scanSingleScout(conn) {
    if (!conn.isConnected()) {
      // 尝试重连
      const success = await conn.reconnect();
      if (!success) {
        this.log('warn', `[${conn.name}] 重连失败`);
        return null;
      }
      this.log('success', `[${conn.name}] 重连成功`);
    }

    try {
      const resp = await conn.sendCommand('bosstower_gethall', {}, 5000);
      const data = conn.parseResponse(resp);

      if (!data || data.error) {
        if (data?.error) {
          this.log('warn', `[${conn.name}] ⚠ ${data.error}`);
        } else {
          this.log('warn', `[${conn.name}] ⏱ 超时或无响应`);
        }
        return null;
      }

      const teams = data.recommendRoleList || [];
      if (teams.length > 0) {
        // 过滤出所有符合条件的队伍
        const validTeams = [];

        for (const team of teams) {
          // 检查是否在黑名单中
          if (this.blockedTeams.has(team.teamId)) {
            this.log('info', `[${conn.name}] ⊗ 跳过僵尸房间 ID: ${team.teamId}`);
            continue;
          }

          // 避免重复处理同一个队伍
          if (team.teamId === this.lastTeamId) {
            this.log('info', `[${conn.name}] ⊘ 跳过重复队伍 ID: ${team.teamId}`);
            continue;
          }

          // 层数字段是 towerId
          const floor = team.towerId;

          // 过滤层数：-1（已过关）、3/6/9/12（BOSS层没奖励）
          const 禁止层数 = [-1, 3, 6, 9, 12];
          if (禁止层数.includes(floor)) {
            this.log('info', `[${conn.name}] ⊘ 跳过禁止层 name: ${team.name}, ID: ${team.teamId}, 层数: ${floor}`);
            continue;
          }

          // 检查层数过滤配置
          if (!this.checkFloorFilter(team)) {
            this.log('info', `[${conn.name}] ⊘ 跳过队伍 name: ${team.name}, ID: ${team.teamId}, 层数: ${floor} (不符合过滤条件)`);
            continue;
          }

          // 符合所有条件，加入候选列表
          validTeams.push(team);
        }

        // 如果有符合条件的队伍，选择层数最高的
        if (validTeams.length > 0) {
          // 按层数降序排序，取第一个（层数最高）
          const bestTeam = validTeams.sort((a, b) => b.towerId - a.towerId)[0];

          this.log('success', `[${conn.name}] 🎉 发现 name: ${bestTeam.name}, ID: ${bestTeam.teamId}, 层数: ${bestTeam.towerId}`);

          // 如果有多个队伍，显示选择信息
          if (validTeams.length > 1) {
            const floors = validTeams.map(t => t.towerId).join(', ');
            this.log('info', `[${conn.name}] 📊 共${validTeams.length}个队伍(层数: ${floors})，选择最高层: ${bestTeam.towerId}`);
          }

          return bestTeam;
        } else {
          this.log('info', `[${conn.name}] ✓ 没有符合条件的队伍`);
          return null;
        }
      } else {
        this.log('info', `[${conn.name}] ✓ 没有队伍`);
        return null;
      }

    } catch (error) {
      this.log('error', `[${conn.name}] ✗ 扫描出错: ${error.message}`);
      return null;
    }
  }

  // 检查层数过滤
  checkFloorFilter(team) {
    const floorConfig = this.config?.层数过滤;

    // 未启用过滤，全部接受
    if (!floorConfig || !floorConfig.启用) {
      return true;
    }

    const floor = team.towerId;  // 层数字段是 towerId
    if (floor === undefined || floor === null) {
      // 没有层数信息，默认接受
      return true;
    }

    // 检查是否在允许列表中
    const allowedFloors = floorConfig.允许层数 || [];
    if (allowedFloors.length === 0) {
      // 没有选择任何层数，默认接受所有
      return true;
    }

    return allowedFloors.includes(floor);
  }

  // 获取指定阵容的英雄ID配置
  async getFormationHeroIds(conn, formationId) {
    try {
      // 1. 获取当前阵容信息
      const getInfoResp = await conn.sendCommand('presetteam_getinfo', {}, 5000);
      const getInfoData = conn.parseResponse(getInfoResp);

      // 调试日志
      this.log('info', `presetteam_getinfo 响应: ${getInfoData ? 'success' : 'null'}`);
      if (getInfoData) {
        this.log('info', `响应字段: ${Object.keys(getInfoData).join(', ')}`);
      }

      if (!getInfoData || !getInfoData.presetTeamInfo) {
        this.log('error', '获取阵容信息失败');
        if (getInfoData) {
          this.log('error', `响应内容: ${JSON.stringify(getInfoData).substring(0, 200)}`);
        }
        return null;
      }

      const currentTeamId = getInfoData.presetTeamInfo.useTeamId;
      this.log('info', `当前阵容: ${currentTeamId}, 目标阵容: ${formationId}`);

      let battleTeamData = null;

      // 2. 判断是否需要切换阵容
      if (currentTeamId === formationId) {
        // 无需切换，直接从 getinfo 数据中提取
        const teamData = getInfoData.presetTeamInfo.presetTeamInfo?.[formationId];
        if (teamData && teamData.teamInfo) {
          // 转换格式
          battleTeamData = {};
          for (const [pos, hero] of Object.entries(teamData.teamInfo)) {
            if (hero && hero.heroId) {
              battleTeamData[pos] = { heroId: hero.heroId };
            }
          }
        }
      } else {
        // 需要切换阵容
        this.log('info', `切换到阵容${formationId}...`);
        const switchResp = await conn.sendCommand('presetteam_saveteam', {
          teamId: formationId
        }, 5000);

        const switchData = conn.parseResponse(switchResp);
        if (switchData && switchData.battleTeam) {
          battleTeamData = switchData.battleTeam;
        }
      }

      // 3. 转换为最终格式：{"0": {"heroId": 110}} → {"0": 110}
      if (battleTeamData) {
        const heroIds = {};
        for (const [pos, hero] of Object.entries(battleTeamData)) {
          if (hero && hero.heroId) {
            heroIds[pos] = hero.heroId;
          }
        }

        this.log('success', `成功获取阵容${formationId}的英雄ID: ${Object.values(heroIds).join(', ')}`);
        return heroIds;
      }

      this.log('error', '未找到阵容数据');
      return null;

    } catch (error) {
      this.log('error', `获取阵容失败: ${error.message}`);
      return null;
    }
  }

  // 执行助战
  async executeAssist(team) {
    // 检查大号连接状态
    if (!this.masterConn || !this.masterConn.isConnected()) {
      this.log('warn', '大号未连接，停止本轮扫描');
      return { success: false, reason: 'disconnected', shouldBreakRound: true };
    }

    this.masterExecuting = true;

    const floor = team.towerId;  // 层数字段是 towerId
    const leaderId = team.id;    // 队长ID

    this.log('info', `========== 开始助战 ==========`);
    this.log('info', `目标 name: ${team.name}, ID: ${team.teamId}, 层数: ${floor}`);

    try {
      // 1. 加入队伍 (matchteam_create)
      this.log('info', '正在加入队伍...');
      const joinResp = await this.masterConn.sendCommand('matchteam_create', {
        custom: {
          leaderId: String(leaderId),  // 使用队长ID
          teamId: team.teamId
        },
        param: 0,
        setting: {
          apply: 0,
          applyList: [],
          name: '',
          notice: '',
          secret: 0
        },
        teamCfgId: 6  // BOSS塔助战的配置ID
      }, 10000);  // 10秒超时

      const joinData = this.masterConn.parseResponse(joinResp);

      // 检查是否已经在房间里
      let alreadyInRoom = false;
      if (joinData && joinData.error) {
        const errorMsg = joinData.error;

        // 判断是否是"已在房间"的错误
        if (errorMsg.includes('在该房间') || errorMsg.includes('已在队伍') || errorMsg.includes('already in')) {
          this.log('info', '已在房间内，直接开始战斗');
          alreadyInRoom = true;
        } else {
          // 所有其他错误都计入失败次数
          this.log('error', `加入队伍失败: ${errorMsg}`);

          // 记录失败次数（不管是什么原因）
          const currentCount = this.teamFullCount.get(team.teamId) || 0;
          const newCount = currentCount + 1;
          this.teamFullCount.set(team.teamId, newCount);

          if (newCount >= 2) {
            // 超过2次，加入黑名单
            this.blockedTeams.add(team.teamId);
            this.log('warn', `队伍 ${team.teamId} 失败${newCount}次，加入黑名单`);
          } else {
            this.log('info', `队伍失败（${newCount}/2次），继续扫描下一个队伍...`);
          }

          // 更新当前大号的失败统计
          const currentMaster = this.masterList[this.currentMasterIndex];
          if (currentMaster) {
            if (!this.masterStats[currentMaster.name]) {
              this.masterStats[currentMaster.name] = { total: 0, success: 0, fail: 0 };
            }
            this.masterStats[currentMaster.name].total++;
            this.masterStats[currentMaster.name].fail++;

            // 保存缓存
            this.saveStatsCache();
          }

          this.masterExecuting = false;
          return { success: false, reason: 'join_failed', shouldContinue: true };
        }
      }

      if (!alreadyInRoom) {
        // 正常加入成功
        const newTeamId = joinData?.teamInfo?.teamId;
        this.log('success', `加入队伍成功`);

        // 记录成功加入的队伍ID
        this.lastTeamId = team.teamId;

        // 等待500ms
        await this.sleep(500);
      }

      // 2. 使用缓存的阵容
      const currentMaster = this.masterList[this.currentMasterIndex];
      const heroIds = this.masterFormationCache[currentMaster.name];

      if (!heroIds) {
        this.log('error', '阵容缓存不存在，这不应该发生');
        this.masterExecuting = false;
        return { success: false, reason: 'formation_cache_missing', shouldBreakRound: true };
      }

      this.log('info', '使用缓存阵容开始战斗...');

      // 3. 设置战斗队伍并开始战斗

      this.log('info', '开始战斗...');

      try {
        await this.masterConn.sendCommand('team_setteam', {
          battleTeam: heroIds,
          cCMonsterId: 0,
          lordWeaponId: 2,
          teamType: 11
        }, 5000);
        this.log('success', '战斗已开始！');
      } catch (e) {
        this.log('warn', `开始战斗失败: ${e.message}`);
      }

      // 4. 等待战斗完成
      this.log('info', '等待战斗完成...');
      await this.sleep(8000);  // 8秒

      // 注意：战斗开始后服务器会自动断开连接，这是正常的
      // 不需要手动离开队伍，战斗会在服务器端自动完成

      // 5. 统计
      this.assistCount++;
      if (floor !== undefined && floor !== null) {
        this.floorStats[floor] = (this.floorStats[floor] || 0) + 1;
      }

      // 更新当前大号的统计
      if (currentMaster) {
        if (!this.masterStats[currentMaster.name]) {
          this.masterStats[currentMaster.name] = { total: 0, success: 0, fail: 0 };
        }
        this.masterStats[currentMaster.name].total++;
        this.masterStats[currentMaster.name].success++;

        // 保存缓存
        this.saveStatsCache();
      }

      this.log('success', `✅ 助战完成！累计: ${this.assistCount} 次`);

      this.masterExecuting = false;
      this.notifyStatusChange();
      return { success: true, shouldContinue: false, shouldBreakRound: false };

    } catch (error) {
      this.log('error', `助战执行出错: ${error.message}`);
      this.masterExecuting = false;
      this.notifyStatusChange();
      return { success: false, reason: 'error', shouldContinue: false, shouldBreakRound: false };
    }
  }

  // 设置大号阵容
  setFormation(formationId) {
    this.masterFormationId = formationId;
    this.log('info', `阵容已设置: ${formationId}号`);
  }

  // 获取状态
  getStatus() {
    const currentMaster = this.masterList[this.currentMasterIndex];
    const masterName = currentMaster ? currentMaster.name : (this.masterConn?.name || '');
    const remainCount = masterName ? (this.masterRemainCounts[masterName] || 0) : 0;

    return {
      running: this.running,
      scanning: this.scanning,
      masterExecuting: this.masterExecuting,
      masterConnected: this.masterConn?.isConnected() || false,
      masterName: masterName,
      masterRemainCount: remainCount,
      masterIndex: this.currentMasterIndex,
      masterTotal: this.masterList.length,
      masterStats: this.masterStats,  // 所有大号的统计数据
      scoutCount: this.scoutConns.length,
      scoutConnected: this.scoutConns.filter(c => c.isConnected()).length,
      assistCount: this.assistCount,
      lastTeamId: this.lastTeamId,
      floorStats: this.floorStats
    };
  }

  // 通知状态变化
  notifyStatusChange() {
    if (this.onStatusChange) {
      this.onStatusChange(this.getStatus());
    }
  }

  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }
}
