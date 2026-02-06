/**
 * 测试获取预设阵容数据
 * 逻辑：
 * 1. 发送 presetteam_getinfo 获取当前阵容ID
 * 2. 如果当前阵容 != 目标阵容，发送 presetteam_saveteam 切换
 * 3. 从响应中提取 battleTeam 英雄ID
 */

import { WebSocketClient } from '../工具/WebSocket客户端.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
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

async function test() {
  console.log('========== 测试获取预设阵容 ==========');

  // 读取大号BIN文件
  const binPath = path.join(__dirname, 'BIN文件/大号/11-98.bin');
  if (!fs.existsSync(binPath)) {
    console.error('BIN文件不存在:', binPath);
    return;
  }

  try {
    // 1. 解析TOKEN
    console.log('正在解析BIN文件...');
    const token = await parseBinFile(binPath);

    // 2. 连接服务器
    console.log('正在连接服务器...');
    const client = new WebSocketClient(主配置.wsServer, token);

    const pendingRequests = new Map();

    client.on('message', (message) => {
      // 使用 seq 字段匹配（响应的 seq 对应发送时的 seq）
      const seq = message.seq;
      if (seq && seq > 0 && pendingRequests.has(seq)) {
        const pending = pendingRequests.get(seq);
        clearTimeout(pending.timeoutId);
        pendingRequests.delete(seq);
        pending.resolve(message);
      }
    });

    await client.connect();
    console.log('连接成功！\n');

    await new Promise(r => setTimeout(r, 1000));

    // 3. 目标阵容编号（测试切换）
    const targetTeamId = 3;

    // 4. 先发送 presetteam_getinfo（空body）获取当前阵容
    console.log('步骤1: 发送 presetteam_getinfo 获取当前阵容...');

    client.send('presetteam_getinfo', {});
    const getInfoSeq = client.seq;

    let getInfoPromise = new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        pendingRequests.delete(getInfoSeq);
        resolve(null);
      }, 10000);

      pendingRequests.set(getInfoSeq, { resolve, timeoutId });
    });

    let response = await getInfoPromise;

    if (!response) {
      console.log('❌ presetteam_getinfo 超时');
      client.disconnect();
      process.exit(1);
      return;
    }

    console.log('✅ presetteam_getinfo 成功');

    // 解析body
    let bodyData = response.body;
    if (bodyData instanceof Uint8Array) {
      bodyData = bon.decode(bodyData);
    }

    // 获取当前阵容编号
    const currentTeamId = bodyData?.presetTeamInfo?.useTeamId;
    console.log(`当前阵容: ${currentTeamId}, 目标阵容: ${targetTeamId}\n`);

    // 5. 如果当前阵容不是目标阵容，则切换
    if (currentTeamId !== targetTeamId) {
      console.log(`步骤2: 切换到阵容${targetTeamId}...`);

      await new Promise(r => setTimeout(r, 500));

      client.send('presetteam_saveteam', {
        teamId: targetTeamId
      });
      const switchSeq = client.seq;

      let switchPromise = new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
          pendingRequests.delete(switchSeq);
          resolve(null);
        }, 10000);

        pendingRequests.set(switchSeq, { resolve, timeoutId });
      });

      response = await switchPromise;

      if (!response) {
        console.log('❌ presetteam_saveteam 超时');
        client.disconnect();
        process.exit(1);
        return;
      } else if (response.error) {
        console.log(`⚠️ 切换失败: ${response.error}`);
        client.disconnect();
        process.exit(1);
        return;
      } else {
        console.log('✅ 切换成功！\n');

        // 解析切换后的body
        bodyData = response.body;
        if (bodyData instanceof Uint8Array) {
          bodyData = bon.decode(bodyData);
        }

        // 调试：打印响应结构
        console.log('切换响应的body结构:', Object.keys(bodyData || {}));
        if (bodyData) {
          console.log('teamId:', bodyData.teamId);
          console.log('battleTeam:', bodyData.battleTeam ? 'exists' : 'not found');
        }
      }
    } else {
      console.log('✅ 当前已是目标阵容，无需切换\n');
    }

    // 6. 解析返回的英雄ID
    console.log('========== 解析英雄ID ==========');

    // 优先从 bodyData.battleTeam 获取（切换阵容后的响应）
    if (bodyData && bodyData.battleTeam) {
      console.log(`✅ 成功获取阵容${bodyData.teamId || targetTeamId}的英雄ID（来自切换响应）:\n`);

      // battleTeam 格式：{"0": {"heroId": 110}, "1": {"heroId": 104}, ...}
      // 转换为：{"0": 110, "1": 104, ...}
      const heroIds = {};
      for (const [pos, hero] of Object.entries(bodyData.battleTeam)) {
        if (hero && hero.heroId) {
          heroIds[pos] = hero.heroId;
        }
      }

      console.log('英雄ID配置（用于 team_setteam 的 battleTeam）:');
      console.log(JSON.stringify(heroIds, null, 2));

      console.log('\n位置分布:');
      Object.entries(heroIds).forEach(([pos, heroId]) => {
        console.log(`  位置${pos}: 英雄${heroId}`);
      });

      console.log('\n✅ 可以直接用于战斗！');
    }
    // 从 presetTeamInfo 获取（getinfo 响应，当前阵容 == 目标阵容时）
    else if (bodyData && bodyData.presetTeamInfo && bodyData.presetTeamInfo.presetTeamInfo) {
      const teamData = bodyData.presetTeamInfo.presetTeamInfo[currentTeamId];

      if (teamData && teamData.teamInfo) {
        console.log(`✅ 成功获取阵容${currentTeamId}的英雄ID（来自getinfo响应）:\n`);

        // teamInfo 格式：{"0": {"heroId": 113}, "1": {"heroId": 112}, ...}
        // 转换为：{"0": 113, "1": 112, ...}
        const heroIds = {};
        for (const [pos, hero] of Object.entries(teamData.teamInfo)) {
          if (hero && hero.heroId) {
            heroIds[pos] = hero.heroId;
          }
        }

        console.log('英雄ID配置（用于 team_setteam 的 battleTeam）:');
        console.log(JSON.stringify(heroIds, null, 2));

        console.log('\n位置分布:');
        Object.entries(heroIds).forEach(([pos, heroId]) => {
          console.log(`  位置${pos}: 英雄${heroId}`);
        });

        console.log('\n✅ 可以直接用于战斗！');
      } else {
        console.log(`⚠️ 阵容${currentTeamId}没有配置英雄`);
      }
    } else {
      console.log('⚠️ 未找到阵容数据');
    }

    // 7. 断开连接
    setTimeout(() => {
      client.disconnect();
      console.log('\n测试完成');
      process.exit(0);
    }, 2000);

  } catch (error) {
    console.error('测试失败:', error.message);
    process.exit(1);
  }
}

test();
