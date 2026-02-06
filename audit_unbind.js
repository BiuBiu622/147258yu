import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LICENSE_FILE = path.join(__dirname, '授权系统/数据/license.dat');
const ADMIN_DATA_FILE = path.join(__dirname, '授权系统/数据/all_licenses.json');

console.log('--- 解绑状态深度审计 ---');

if (!fs.existsSync(LICENSE_FILE)) {
    console.log('❌ 错误：本地激活文件 license.dat 不存在');
} else {
    const clientKey = fs.readFileSync(LICENSE_FILE, 'utf-8').trim();
    console.log('本地授权码 (前20位):', clientKey.substring(0, 20));

    if (!fs.existsSync(ADMIN_DATA_FILE)) {
        console.log('❌ 错误：数据库文件 all_licenses.json 不存在');
    } else {
        const all = JSON.parse(fs.readFileSync(ADMIN_DATA_FILE, 'utf-8'));
        console.log('数据库总记录数:', all.length);

        const record = all.find(l => l.licenseKey === clientKey);
        if (record) {
            console.log('✅ 找到匹配记录');
            console.log('记录 ID:', record.id);
            console.log('库中绑定的机器码:', record.machineId === null ? 'null (已解绑)' : record.machineId);
            console.log('记录状态:', record.status);

            if (!record.machineId) {
                console.log('>> 结论：逻辑上应该判定为【未授权】');
            } else {
                console.log('>> 结论：逻辑上依然判定为【已授权】');
            }
        } else {
            console.log('❌ 未找到匹配记录');
            console.log('这可能是因为本地 license.dat 里的授权码在数据库中根本不存在（或者被删除了）');
        }
    }
}
