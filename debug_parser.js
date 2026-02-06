import { parseLicenseString } from './工具/internal/security/sys-crypto.js';
import fs from 'fs';
import path from 'path';

const ADMIN_DATA_FILE = './授权系统/数据/all_licenses.json';

try {
    const data = JSON.parse(fs.readFileSync(ADMIN_DATA_FILE, 'utf-8'));
    console.log(`找到 ${data.length} 条授权记录`);

    data.forEach((item, index) => {
        console.log(`\n--- 记录 ${index + 1} ---`);
        console.log('ID:', item.id);
        console.log('绑定机器码:', item.machineId);

        const parsed = parseLicenseString(item.licenseKey);
        if (parsed) {
            console.log('✅ 解析成功:', JSON.stringify(parsed, null, 2));
        } else {
            console.log('❌ 解析失败');
        }
    });
} catch (e) {
    console.error('测试出错:', e);
}
