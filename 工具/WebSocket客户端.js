/**
 * WebSocket客户端 - 使用原项目的BON协议
 */

import WebSocket from 'ws';
import { bon, getEnc } from './BON协议.js';
import { 信息日志, 成功日志, 错误日志, 警告日志 } from './日志工具.js';

// 命令名称映射表（将技术代码转为人类可读的含义）
const 命令名称映射 = {
  // 系统命令
  '_sys/ack': '心跳包',
  '_sys/heartbeat': '心跳检测',
  'SyncResp': '数据同步',

  // 角色信息
  'role_getroleinfo': '获取角色信息',
  'Role_GetRoleInfoResp': '角色信息响应',
  'role_switchformation': '切换阵容',

  // 挂机相关
  'system_mysharecallback': '分享回调',
  'system_claimhangupreward': '领取挂机奖励',
  'System_ClaimHangUpRewardResp': '挂机奖励响应',

  // 盐罐机器人
  'bottlehelper_claim': '领取盐罐奖励',
  'bottlehelper_stop': '停止盐罐机器人',
  'bottlehelper_start': '启动盐罐机器人',
  'BottleHelper_ClaimResp': '盐罐奖励响应',

  // 任务相关
  'task_claimdailyreward': '领取日常任务奖励',
  'task_claimweekreward': '领取周常任务奖励',
  'task_claimdailypoint': '领取任务点数奖励',

  // 俱乐部
  'legion_signin': '俱乐部签到',
  'Legion_SignInResp': '签到响应',

  // 招募
  'hero_recruit': '英雄招募',

  // 邮件
  'mail_claimallattachment': '领取所有邮件',

  // 礼包
  'discount_claimreward': '领取每日礼包',
  'card_claimreward': '领取礼包卡',
  'collection_claimfreereward': '领取免费奖励',

  // 好友
  'friend_batch': '赠送好友金币',

  // 点金
  'system_buygold': '点金',

  // 宝箱
  'item_openbox': '开启宝箱',

  // 钓鱼
  'artifact_lottery': '神器抽奖',

  // 灯神
  'genie_sweep': '灯神扫荡',
  'genie_buysweep': '购买扫荡券',

  // 黑市
  'store_purchase': '黑市清单购买',
  'store_buy': '黑市手动购买',
  'store_refresh': '刷新黑市',

  // 竞技场
  'arena_startarea': '开始竞技场',
  'arena_getareatarget': '获取竞技场目标',

  // 战斗
  'fight_startareaarena': '竞技场战斗',
  'fight_startlegionboss': '军团BOSS战斗',
  'fight_startboss': '每日BOSS战斗',
  'fight_starttower': '开始爬塔',

  // 签到
  'system_signinreward': '福利签到',

  // 车辆（疯狂赛车）
  'car_getrolecar': '获取车辆信息',
  'Car_GetRoleCarResp': '车辆信息响应',
  'car_claim': '收车',
  'Car_ClaimResp': '收车响应',
  'car_send': '发车',
  'Car_SendResp': '发车响应',
  'car_refresh': '刷新车辆品阶',
  'Car_RefreshResp': '刷新车辆响应'
};

// 获取命令的中文名称
function 获取命令名称(cmd) {
  return 命令名称映射[cmd] || cmd;
}

/**
 * WebSocket客户端类
 */
export class WebSocketClient {
  constructor(wsUrl, token) {
    this.wsUrl = wsUrl;
    this.token = token;
    this.ws = null;
    this.connected = false;
    this.seq = 0;
    this.ack = 0;
    this.heartbeatTimer = null;
    this.heartbeatTimeoutTimer = null;  // 心跳超时检测
    this.lastHeartbeatResponse = Date.now();  // 最后一次收到心跳响应的时间
    this.messageHandlers = new Map();
    this.isReconnecting = false;  // 是否正在重连
    this.reconnectAttempts = 0;   // 重连尝试次数
    this.maxReconnectAttempts = 3;  // 最大重连次数
    this.heartbeatTimeoutEnabled = true; // 是否开启心跳超时检测
  }

  /**
   * 连接WebSocket
   */
  connect() {
    return new Promise((resolve, reject) => {
      // 设置60秒超时（增加超时时间）
      const timeout = setTimeout(() => {
        if (this.ws) {
          this.ws.close();
        }
        reject(new Error('WebSocket连接超时'));
      }, 60000);

      try {
        const tokenParam = encodeURIComponent(this.token);
        const fullUrl = `${this.wsUrl}?p=${tokenParam}&e=x&lang=chinese`;

        信息日志(`正在连接: ${this.wsUrl}`);

        this.ws = new WebSocket(fullUrl);

        this.ws.on('open', () => {
          clearTimeout(timeout);
          成功日志('WebSocket连接成功');
          this.connected = true;
          this.startHeartbeat();
          resolve();
        });

        this.ws.on('message', (data) => {
          this.handleMessage(data);
        });

        this.ws.on('error', (error) => {
          clearTimeout(timeout);
          错误日志('WebSocket错误:', error.message);
          reject(error);
        });

        this.ws.on('close', () => {
          clearTimeout(timeout);
          警告日志('WebSocket连接已关闭');
          this.connected = false;
          this.stopHeartbeat();
        });

      } catch (error) {
        clearTimeout(timeout);
        错误日志('连接失败:', error.message);
        reject(error);
      }
    });
  }

  /**
   * 处理接收到的消息
   */
  handleMessage(data) {
    try {
      const buffer = new Uint8Array(data);

      // 使用原项目的自动解密
      const enc = getEnc('auto');
      const decrypted = enc.decrypt(buffer);

      // BON解码
      const message = bon.decode(decrypted);

      if (!message || typeof message !== 'object') {
        return;
      }

      // 更新ack
      if (message.seq) {
        this.ack = message.seq;
      }

      // 心跳处理
      if (message.cmd === '_sys/heartbeat') {
        this.lastHeartbeatResponse = Date.now();  // 更新心跳响应时间
        this.sendHeartbeatAck();
        const handler = this.messageHandlers.get('_sys/heartbeat');
        if (handler) handler(message);
        return;
      }

      // _sys/ack 响应也算心跳响应
      if (message.cmd === '_sys/ack') {
        this.lastHeartbeatResponse = Date.now();
        return;
      }

      // ===== 检查错误消息 =====
      if (message.error) {
        const errText = String(message.error);
        警告日志(`服务器返回错误: ${errText}`);

        // 调用错误处理器
        const errorHandler = this.messageHandlers.get('error');
        if (errorHandler) {
          errorHandler(message);
        }

        // ✅ 仍然调用通用message处理器，让任务自己处理错误
        const generalHandler = this.messageHandlers.get('message');
        if (generalHandler) {
          generalHandler(message);
        }

        // ✅ 不要return，让后续代码继续处理
        // return; // ❌ 删除这行，让错误消息也能被处理
      }
      // ==============================

      // 调用消息处理器
      if (message.cmd) {
        // 首先调用通用message处理器
        const generalHandler = this.messageHandlers.get('message');
        if (generalHandler) {
          generalHandler(message);
        }

        // ===== 调试日志：打印所有收到的命令（包括心跳和聊天） =====
        // console.log(`[DEBUG] 收到消息: ${message.cmd}`);
        // =========================================

        // 然后调用特定cmd处理器
        const handler = this.messageHandlers.get(message.cmd);
        if (handler) {
          handler(message);
        }
        // 没有处理器的消息静默忽略，不输出日志（减少噪音）
      }

    } catch (error) {
      错误日志('消息解析失败:', error.message);
    }
  }

  /**
   * 发送消息
   * @returns {boolean} 是否发送成功
   */
  send(cmd, body = {}) {
    if (!this.connected || !this.ws || this.ws.readyState !== 1) {
      错误日志('WebSocket未连接，无法发送命令');
      return false;
    }

    try {
      this.seq++;

      const encodedBody = bon.encode(body);

      const message = {
        cmd,
        seq: this.seq,
        ack: this.ack,
        time: Date.now(),
        body: encodedBody
      };

      // ===== 调试：打印完整消息 =====
      // if (cmd === 'study_startgame' || cmd === 'system_custom') {
      //   console.log(`[DEBUG] 发送消息:`, {
      //     cmd: message.cmd,
      //     seq: message.seq,
      //     ack: message.ack,
      //     time: message.time,
      //     body: body,
      //     encodedBody: encodedBody
      //   });
      // }
      // ===================================

      const encoded = bon.encode(message);

      // 使用原项目的x加密
      const enc = getEnc('x');
      const encrypted = enc.encrypt(encoded);

      this.ws.send(encrypted);

      // 显示中文名称而非技术代码
      const 命令名称 = 获取命令名称(cmd);
      信息日志(`发送命令: ${命令名称}`);

      return true;
    } catch (error) {
      错误日志('发送失败:', error.message);
      console.error(error);
      return false;
    }
  }

  /**
   * 检查连接是否正常
   * @returns {boolean} 连接是否正常
   */
  isConnected() {
    return this.connected && this.ws && this.ws.readyState === 1;
  }

  /**
   * 重新连接
   * @returns {Promise<boolean>} 是否重连成功
   */
  async reconnect() {
    if (this.isReconnecting) {
      警告日志('正在重连中，请等待...');
      return false;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    信息日志(`尝试重连 (第${this.reconnectAttempts}次)...`);

    try {
      // 先断开旧连接
      this.stopHeartbeat();
      if (this.ws) {
        try {
          this.ws.close();
        } catch (e) {
          // 忽略关闭错误
        }
        this.ws = null;
      }
      this.connected = false;

      // 等待500ms后重连
      await new Promise(resolve => setTimeout(resolve, 500));

      // 重新连接
      await this.connect();

      成功日志('重连成功');
      this.reconnectAttempts = 0;
      this.isReconnecting = false;
      return true;
    } catch (error) {
      错误日志(`重连失败: ${error.message}`);
      this.isReconnecting = false;

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        警告日志(`将在2秒后重试 (剩余${this.maxReconnectAttempts - this.reconnectAttempts}次)`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return this.reconnect();
      } else {
        错误日志(`重连失败，已达到最大重试次数 (${this.maxReconnectAttempts}次)`);
        this.reconnectAttempts = 0;
        return false;
      }
    }
  }

  /**
   * 启动心跳
   */
  startHeartbeat() {
    // 清除旧的定时器
    this.stopHeartbeat();

    // 初始化心跳响应时间
    this.lastHeartbeatResponse = Date.now();

    // 延迟2秒后发送首次心跳，避免连接刚建立就发送
    setTimeout(() => {
      if (this.connected && this.ws && this.ws.readyState === 1) {
        this.sendHeartbeatPacket();
      }
    }, 2000);

    // 每3秒发送一次心跳包保持连接稳定
    this.heartbeatTimer = setInterval(() => {
      if (!this.connected || !this.ws || this.ws.readyState !== 1) {
        return;
      }

      this.sendHeartbeatPacket();
    }, 3000);

    // 启动心跳超时检测（每5秒检测一次，超过10秒没收到响应则认为断连）
    this.heartbeatTimeoutTimer = setInterval(() => {
      if (!this.connected || !this.heartbeatTimeoutEnabled) return;

      const timeSinceLastResponse = Date.now() - this.lastHeartbeatResponse;
      if (timeSinceLastResponse > 10000) {  // 10秒没收到心跳响应
        警告日志(`心跳超时 (${Math.round(timeSinceLastResponse / 1000)}秒无响应)，连接可能已断开`);

        // 触发断连事件，让任务知道需要重连
        const disconnectHandler = this.messageHandlers.get('disconnect');
        if (disconnectHandler) {
          disconnectHandler({ reason: 'heartbeat_timeout' });
        }

        // 标记为断开状态
        this.connected = false;
      }
    }, 5000);
  }

  /**
   * 发送心跳包
   */
  sendHeartbeatPacket() {
    try {
      const message = {
        cmd: '_sys/ack',  // 心跳命令
        seq: 0,           // 心跳seq必须为0
        ack: this.ack,
        time: Date.now(),
        body: {}
      };

      const encoded = bon.encode(message);
      const enc = getEnc('x');
      const encrypted = enc.encrypt(encoded);
      this.ws.send(encrypted);
    } catch (error) {
      错误日志('发送心跳失败:', error.message);
    }
  }

  /**
   * 心跳ACK响应
   */
  sendHeartbeatAck() {
    if (!this.connected) return;

    try {
      const message = {
        cmd: '_sys/ack',
        seq: this.seq,
        ack: this.ack,
        time: Date.now(),
        body: {}
      };

      const encoded = bon.encode(message);
      const enc = getEnc('x');
      const encrypted = enc.encrypt(encoded);
      this.ws.send(encrypted);

    } catch (error) {
      错误日志('心跳响应失败:', error.message);
    }
  }

  /**
   * 停止心跳
   */
  /**
   * 停止心跳超时检测
   */
  stopTimeoutCheck() {
    this.heartbeatTimeoutEnabled = false;
    if (this.heartbeatTimeoutTimer) {
      clearInterval(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatTimeoutTimer) {
      clearInterval(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  /**
   * 注册消息处理器
   */
  on(cmd, handler) {
    this.messageHandlers.set(cmd, handler);
  }

  /**
   * 移除消息处理器
   */
  off(cmd, handler) {
    this.messageHandlers.delete(cmd);
  }

  /**
   * 断开连接
   */
  disconnect() {
    this.stopHeartbeat();
    this.messageHandlers.clear(); // 清理消息处理器，避免内存泄漏
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    信息日志('已断开连接');
  }

  /**
   * 移除所有监听器（新增方法，修复每日任务执行问题）
   */
  removeAllListeners() {
    this.messageHandlers.clear();
  }

  /**
   * 断开连接（别名）
   */
  断开连接() {
    this.disconnect();
  }
}

/**
 * 创建WebSocket客户端（工厂函数）
 */
export function 创建WebSocket客户端() {
  return {
    ws: null,
    promises: {},  // 存储 Promise

    连接: async function (token) {
      // 读取配置
      const fs = await import('fs');
      const path = await import('path');
      const { fileURLToPath } = await import('url');
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const configPath = path.join(__dirname, '../config/config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

      this.ws = new WebSocketClient(config.wsServer, token);

      // 注册消息监听器，处理 Promise 响应
      this.ws.on('message', (message) => {
        this.handleResponse(message);
      });

      await this.ws.connect();
    },

    handleResponse: function (message) {
      const cmd = message.cmd;

      // ✅ 优先处理错误消息（即使没有 cmd）
      if (message.error && Object.keys(this.promises).length > 0) {
        // 尝试匹配最近发送的命令（按时间戳排序）
        const sortedPromises = Object.entries(this.promises).sort((a, b) => {
          const aTime = parseInt(a[0].split('_')[1] || '0');
          const bTime = parseInt(b[0].split('_')[1] || '0');
          return bTime - aTime; // 降序，最新的在前
        });

        // 匹配第一个等待的 Promise
        if (sortedPromises.length > 0) {
          const [requestId, promiseData] = sortedPromises[0];
          delete this.promises[requestId];
          // resolve 错误消息，让任务自己处理
          promiseData.resolve(message);
          return;
        }
      }

      if (!cmd) return;

      // 响应命令到请求命令的映射
      const responseMap = {
        'Car_GetRoleCarResp': 'car_getrolecar',
        'car_getrolecarresp': 'car_getrolecar',
        'Car_ClaimResp': 'car_claim',
        'car_claimresp': 'car_claim',
        'Car_SendResp': 'car_send',
        'car_sendresp': 'car_send',
        'Car_RefreshResp': 'car_refresh',
        'car_refreshresp': 'car_refresh',
        'Role_GetRoleInfoResp': 'role_getroleinfo',
        'role_getroleinforesp': 'role_getroleinfo',
        'BottleHelper_StartResp': 'bottlehelper_start',
        'bottlehelper_startresp': 'bottlehelper_start',
        'BottleHelper_StopResp': 'bottlehelper_stop',
        'bottlehelper_stopresp': 'bottlehelper_stop',
        'BottleHelper_GetHelperRewardResp': 'bottlehelper_gethelperreward',
        'bottlehelper_gethelperrewardresp': 'bottlehelper_gethelperreward',
        // 竞技场相关映射
        'Arena_StartAreaResp': 'arena_startarea',
        'arena_startarearesp': 'arena_startarea',
        'Arena_GetArenaInfoResp': 'arena_getarenainfo',
        'arena_getarenainforesp': 'arena_getarenainfo',
        'Arena_GetAreaTargetResp': 'arena_getareatarget',
        'arena_getareatargetresp': 'arena_getareatarget',
        'Fight_StartArenarenaResp': 'fight_startareaarena',
        'fight_startarearenaresp': 'fight_startareaarena',
        'Fight_StartAreaArenaResp': 'fight_startareaarena',
        'fight_startareaarenaresp': 'fight_startareaarena',
        'Fight_StartAreaarenaResp': 'fight_startareaarena',
        'fight_startareaarenaresp': 'fight_startareaarena',
        // 随机数种子相关映射
        'Role_GetRandomSeedResp': 'role_getrandomseed',
        'role_getrandomseedresp': 'role_getrandomseed',
        // 答题相关映射
        'StudyResp': 'study_startgame',
        'studyresp': 'study_startgame',
        'Study_StartGameResp': 'study_startgame',
        'study_startgameresp': 'study_startgame',
        // 系统相关映射（挂机、分享等）
        'SyncResp': 'system_mysharecallback',
        'syncresp': 'system_mysharecallback',
        'System_ClaimHangUpRewardResp': 'system_claimhangupreward',
        'system_claimhanguprewardresp': 'system_claimhangupreward',
        // 怪异塔相关映射
        'EvoTower_GetInfoResp': 'evotower_getinfo',
        'evotower_getinforesp': 'evotower_getinfo',
        'EvoTower_ReadyFightResp': 'evotower_readyfight',
        'evotower_readyfightresp': 'evotower_readyfight',
        'EvoTower_FightResp': 'evotower_fight',
        'evotower_fightresp': 'evotower_fight',
        'EvoTower_ClaimRewardResp': 'evotower_claimreward',
        'evotower_claimrewardresp': 'evotower_claimreward',
        'EvoTower_ClaimTaskResp': 'evotower_claimtask',
        'evotower_claimtaskresp': 'evotower_claimtask'
      };

      const originalCmd = responseMap[cmd] || cmd.toLowerCase().replace('resp', '').replace(/_/g, '');

      // 查找对应的 Promise
      for (const [requestId, promiseData] of Object.entries(this.promises)) {
        // 严格匹配：必须匹配cmd或者originalCmd匹配promiseData.originalCmd
        const cmdMatch = promiseData.originalCmd === originalCmd ||
          promiseData.originalCmd === cmd ||
          promiseData.originalCmd.toLowerCase().replace(/_/g, '') === originalCmd;

        if (cmdMatch) {
          delete this.promises[requestId];

          // 获取响应数据，需要解码 body
          let responseBody = message.body;

          // 如果 body 是对象格式的字节数组，需要用 BON 解码
          if (responseBody && typeof responseBody === 'object' && !Array.isArray(responseBody)) {
            const keys = Object.keys(responseBody);
            // 检查是否是数字键的对象（BON 编码的二进制数据）
            if (keys.length > 0 && keys.every(key => !isNaN(parseInt(key)))) {
              try {
                // 转换为 Uint8Array
                const bytes = new Uint8Array(Object.values(responseBody));
                // 使用 BON 解码
                responseBody = bon.decode(bytes);
                信息日志('BON 解码成功');
              } catch (error) {
                错误日志('BON 解码失败:', error.message);
              }
            }
          }

          // ✅ 如果消息包含错误，也要 resolve，让任务自己处理错误
          promiseData.resolve(responseBody || message);
          break;
        }
      }

      // ✅ 如果消息包含错误但没有匹配到 Promise，尝试匹配所有等待的 Promise（处理错误消息 cmd 不匹配的情况）
      if (message.error && Object.keys(this.promises).length > 0) {
        // 尝试匹配最近发送的命令（按时间戳排序）
        const sortedPromises = Object.entries(this.promises).sort((a, b) => {
          const aTime = parseInt(a[0].split('_')[1] || '0');
          const bTime = parseInt(b[0].split('_')[1] || '0');
          return bTime - aTime; // 降序，最新的在前
        });

        // 匹配第一个等待的 Promise（假设错误消息是对最近发送的命令的响应）
        if (sortedPromises.length > 0) {
          const [requestId, promiseData] = sortedPromises[0];
          delete this.promises[requestId];

          // 直接 resolve 错误消息，让任务自己处理
          promiseData.resolve(message);
        }
      }
    },

    发送指令: async function (cmd, body = {}, desc = '', timeout = 10000) {
      return new Promise((resolve, reject) => {
        if (!this.ws || !this.ws.connected) {
          return reject(new Error('WebSocket未连接'));
        }

        // 生成唯一 ID
        const requestId = `${cmd}_${Date.now()}_${Math.random()}`;

        // 超时处理
        const timer = setTimeout(() => {
          delete this.promises[requestId];
          reject(new Error(`请求超时: ${cmd} (${timeout}ms)`));
        }, timeout);

        // 存倨Promise（包括 timer 以便清理）
        this.promises[requestId] = {
          resolve: (data) => {
            clearTimeout(timer);
            resolve(data);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
          originalCmd: cmd,
          timer
        };

        // 发送消息
        try {
          this.ws.send(cmd, body);
        } catch (error) {
          clearTimeout(timer);
          delete this.promises[requestId];
          reject(error);
        }
      });
    },

    获取角色信息: async function () {
      const response = await this.发送指令('role_getroleinfo', {});
      return response;
    },

    断开连接: function () {
      if (this.ws) {
        this.ws.disconnect();
      }
    }
  };
}
