import { execSync } from 'child_process';
import crypto from 'crypto';

/**
 * 提取硬件特征
 */
export function getMachineId() {
    try {
        let hardwareInfo = '';

        // 1. CPU
        try {
            const cpuId = execSync('wmic cpu get processorid').toString().replace(/ProcessorId/g, '').trim();
            hardwareInfo += cpuId;
        } catch (e) {
            // ignore
        }

        // 2. Baseboard
        try {
            const baseboardSerial = execSync('wmic baseboard get serialnumber').toString().replace(/SerialNumber/g, '').trim();
            hardwareInfo += baseboardSerial;
        } catch (e) {
            // ignore
        }

        // 3. Disk
        try {
            const diskSerial = execSync('wmic diskdrive get serialnumber').toString().replace(/SerialNumber/g, '').split('\n')[1].trim();
            hardwareInfo += diskSerial;
        } catch (e) {
            // ignore
        }

        if (!hardwareInfo || hardwareInfo.length < 5) {
            hardwareInfo = process.env.COMPUTERNAME || 'NODE-HASH';
        }

        const hash = crypto.createHash('sha256').update(hardwareInfo).digest('hex').toUpperCase();
        return hash.substring(0, 16);
    } catch (error) {
        return 'ERR-SYSTEM-NODE';
    }
}
