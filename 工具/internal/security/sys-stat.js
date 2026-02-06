import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getMachineId } from './sys-fingerprint.js';
import { verifyLicense, checkAuth } from './sys-verify.js';
import { generateLicenseString, parseLicenseString } from './sys-crypto.js';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LICENSE_FILE = path.join(__dirname, '../../../data/license.dat');
const ADMIN_DATA_FILE = path.join(__dirname, '../../../授权系统/数据/all_licenses.json');

/**
 * 获取系统授权概览 (支持远程模式)
 */
export async function getLicenseStatus() {
    const machineId = getMachineId();
    let info = verifyLicense();

    // ✅ 如果本地验证失败，且本地没有数据库文件（dist 模式），尝试请求远程验证
    if ((!info || info.error) && !fs.existsSync(ADMIN_DATA_FILE) && fs.existsSync(LICENSE_FILE)) {
        console.log('[系统日志] 环境验证中...');
        try {
            const licenseKey = fs.readFileSync(LICENSE_FILE, 'utf-8').trim();
            const response = await fetch(`${REMOTE_SOURCE}/api/license/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ licenseKey, machineId })
            });
            const result = await response.json();
            if (result.authorized) {
                info = {
                    success: true,
                    type: result.type,
                    expiresAt: result.expiresAt,
                    activatedAt: result.activatedAt,
                    note: result.note || ''
                };
            }
        } catch (err) {
            // 静默失败
        }
    }

    if (!info || info.error) {
        return {
            authorized: false,
            machineId,
            error: info ? info.error : 'NO_LICENSE'
        };
    }

    return {
        authorized: true,
        machineId,
        type: info.type,
        activatedAt: info.activatedAt,
        expiresAt: info.expiresAt,
        note: info.note
    };
}

/**
 * 远程源
 */
const REMOTE_SOURCE = 'http://117.72.150.63:3100';

/**
 * 核心初始化 (远程验证模式)
 */
export async function activateLicense(licenseKey) {
    try {
        const key = licenseKey.trim().toUpperCase();

        // 格式预检
        const formatCheck = parseLicenseString(key);
        const currentMachineId = getMachineId();

        if (!formatCheck || !formatCheck.valid) {
            return { success: false, error: 'INVALID_FORMAT' };
        }

        // ✅ 连接远程服务
        try {
            const response = await fetch(`${REMOTE_SOURCE}/api/admin/license/activate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ licenseKey: key, machineId: currentMachineId })
            });

            const result = await response.json();

            if (result.success) {
                // ✅ 写入凭证
                const dataDir = path.dirname(LICENSE_FILE);
                if (!fs.existsSync(dataDir)) {
                    fs.mkdirSync(dataDir, { recursive: true });
                }

                fs.writeFileSync(LICENSE_FILE, key, 'utf-8');

                const status = await getLicenseStatus();
                return { success: true, ...status };
            } else {
                return { success: false, error: result.error || 'ACTIVATION_FAILED' };
            }
        } catch (networkError) {
            return { success: false, error: 'NETWORK_ERROR' };
        }
    } catch (e) {
        return { success: false, error: 'INTERNAL_ERROR' };
    }
}

/**
 * 内部记录获取 (模拟后台数据库)
 */
export function adminGetLicenses() {
    try {
        if (!fs.existsSync(ADMIN_DATA_FILE)) return [];
        return JSON.parse(fs.readFileSync(ADMIN_DATA_FILE, 'utf-8'));
    } catch (e) {
        return [];
    }
}

/**
 * 内部记录生成
 */
export function adminGenerateLicense(options) {
    const { machineId, type, note } = options;

    let expiresAt = 'permanent';
    if (type === 'trial') {
        const date = new Date();
        date.setDate(date.getDate() + 7);
        expiresAt = date.toISOString();
    } else if (type === 'standard') {
        const date = new Date();
        date.setFullYear(date.getFullYear() + 1);
        expiresAt = date.toISOString();
    }

    const data = {
        machineId,
        type,
        expiresAt,
        activatedAt: new Date().toISOString(),
        note: note || ''
    };

    const licenseKey = generateLicenseString(data);

    // 保存到管理员记录
    const all = adminGetLicenses();
    const record = {
        id: crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(),
        licenseKey,
        ...data,
        createdAt: new Date().toISOString(),
        status: 'pending'
    };
    all.push(record);
    fs.writeFileSync(ADMIN_DATA_FILE, JSON.stringify(all, null, 2), 'utf-8');

    return { success: true, licenseKey, record };
}

/**
 * 内部解绑
 */
export function adminUnbindLicense(id) {
    let all = adminGetLicenses();
    const index = all.findIndex(l => l.id === id);
    if (index !== -1) {
        all[index].machineId = null;
        all[index].status = 'unbound';
        fs.writeFileSync(ADMIN_DATA_FILE, JSON.stringify(all, null, 2), 'utf-8');
        return { success: true };
    }
    return { success: false, error: 'NOT_FOUND' };
}

/**
 * 内部删除
 */
export function adminDeleteLicense(id) {
    let all = adminGetLicenses();
    const filtered = all.filter(l => l.id !== id);
    if (filtered.length !== all.length) {
        fs.writeFileSync(ADMIN_DATA_FILE, JSON.stringify(filtered, null, 2), 'utf-8');
        return { success: true };
    }
    return { success: false, error: 'NOT_FOUND' };
}
