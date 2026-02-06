import { verifyLicense } from './工具/internal/security/sys-verify.js';
import { getMachineId } from './工具/internal/security/sys-fingerprint.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ADMIN_DATA_FILE = path.join(__dirname, '授权系统/数据/all_licenses.json');
const LICENSE_FILE = path.join(__dirname, 'data/license.dat');

async function testAll() {
    const currentMachineId = getMachineId();
    console.log('当前机器码:', currentMachineId);

    const all = JSON.parse(fs.readFileSync(ADMIN_DATA_FILE, 'utf-8'));

    for (const [index, record] of all.entries()) {
        console.log(`\n--- 测试记录 #${index + 1} (ID: ${record.id}) ---`);
        console.log('库中绑定的机器码:', record.machineId || '(未绑定)');

        // 模拟写入激活文件
        fs.writeFileSync(LICENSE_FILE, record.licenseKey, 'utf-8');

        // 执行验证
        const result = verifyLicense();
        console.log('验证结果:', JSON.stringify(result, null, 2));
    }
}

testAll();
