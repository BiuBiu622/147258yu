/**
 * 手动刷新所有账号的赛车状态到Web
 * 仅获取并保存状态，不执行收车发车
 */
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('========================================');
console.log('手动刷新所有账号的赛车状态');
console.log('========================================\n');

async function main() {
  try {
    const scriptPath = path.join(__dirname, '../任务/疯狂赛车/index.js');
    console.log('正在执行赛车任务脚本（仅获取状态）...\n');
    
    const { stdout, stderr } = await execAsync(`node "${scriptPath}"`, {
      cwd: path.dirname(scriptPath),
      timeout: 300000 // 5分钟超时
    });
    
    if (stdout) {
      console.log(stdout);
    }
    
    if (stderr) {
      console.error(stderr);
    }
    
    console.log('\n========================================');
    console.log('✅ 状态刷新完成！');
    console.log('========================================');
    console.log('请查看Web页面确认状态已更新\n');
    
  } catch (error) {
    console.error('❌ 刷新失败:', error.message);
    process.exit(1);
  }
}

main();
