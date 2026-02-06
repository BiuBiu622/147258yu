import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getMachineId } from './sys-fingerprint.js';
import { parseLicenseString } from './sys-crypto.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LICENSE_FILE = path.join(__dirname, '../../../data/license.dat');

/**
 * 环境检查
 * @returns {Object|null}
 */
export function verifyLicense() {
    try {
        if (!fs.existsSync(LICENSE_FILE)) {
            return null;
        }

        const licenseCode = fs.readFileSync(LICENSE_FILE, 'utf-8').trim();

        // 校验
        const formatCheck = parseLicenseString(licenseCode);
        const currentMachineId = getMachineId();

        if (!formatCheck || !formatCheck.valid) {
            return { error: 'INVALID_ENV', machineId: currentMachineId };
        }

        // 管理端数据校验路径
        const ADMIN_DATA_FILE = path.join(__dirname, '../../../授权系统/数据/all_licenses.json');
        if (!fs.existsSync(ADMIN_DATA_FILE)) {
            return { error: 'LOCAL_DB_MISSING', machineId: currentMachineId };
        }

        try {
            const all = JSON.parse(fs.readFileSync(ADMIN_DATA_FILE, 'utf-8'));
            const record = all.find(l => l.licenseKey === licenseCode);

            if (!record) {
                return { error: 'ID_REVOKED', machineId: currentMachineId };
            }

            // 状态检查
            if (record.status === 'unbound') {
                return { error: 'ID_UNBOUND', machineId: currentMachineId };
            }

            // 绑定检查
            if (record.machineId && record.machineId !== currentMachineId) {
                return { error: 'ID_MISMATCH', machineId: currentMachineId };
            }

            // 时效检查
            if (record.expiresAt !== 'permanent') {
                const expireTime = new Date(record.expiresAt).getTime();
                const now = Date.now();
                if (now > expireTime) {
                    return { error: 'EXPIRED', expireTime: record.expiresAt };
                }
            }

            return {
                machineId: record.machineId,
                type: record.type,
                expiresAt: record.expiresAt,
                activatedAt: record.activatedAt,
                note: record.note,
                success: true
            };
        } catch (err) {
            return { error: 'DB_ERROR', message: err.message, machineId: currentMachineId };
        }
    } catch (e) {
        return { error: 'SYSTEM_ERROR', message: e.message, machineId: getMachineId() };
    }
}

/**
 * 快速状态检查
 */
export function checkAuth() {
    const result = verifyLicense();
    return !!(result && result.success);
}
