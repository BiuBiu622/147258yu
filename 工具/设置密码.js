/**
 * 设置登录密码工具
 * 使用 bcrypt 加密存储密码
 */

import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const usersFile = path.join(__dirname, '../data/users.json');

// 创建命令行输入接口
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// 提示输入（支持隐藏密码输入）
function question(prompt, hidden = false) {
  return new Promise((resolve) => {
    if (hidden) {
      // 隐藏密码输入
      process.stdout.write(prompt);
      process.stdin.setRawMode(true);
      process.stdin.resume();
      
      let password = '';
      process.stdin.on('data', (char) => {
        char = char.toString();
        
        if (char === '\n' || char === '\r' || char === '\u0004') {
          // Enter键
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write('\n');
          resolve(password);
        } else if (char === '\u0003') {
          // Ctrl+C
          process.exit();
        } else if (char === '\u007f') {
          // 退格键
          password = password.slice(0, -1);
          process.stdout.clearLine();
          process.stdout.cursorTo(0);
          process.stdout.write(prompt + '*'.repeat(password.length));
        } else {
          // 正常字符
          password += char;
          process.stdout.write('*');
        }
      });
    } else {
      rl.question(prompt, resolve);
    }
  });
}

async function main() {
  console.log('');
  console.log('========================================');
  console.log('  设置 Web 登录密码');
  console.log('========================================');
  console.log('');
  
  // 输入用户名
  const username = await question('请输入用户名 (默认: admin): ');
  const finalUsername = username.trim() || 'admin';
  
  // 输入密码
  const password = await question('请输入密码: ', true);
  
  if (!password || password.length < 6) {
    console.log('');
    console.log('❌ 密码至少需要 6 个字符！');
    process.exit(1);
  }
  
  // 确认密码
  const confirmPassword = await question('请再次输入密码: ', true);
  
  if (password !== confirmPassword) {
    console.log('');
    console.log('❌ 两次输入的密码不一致！');
    process.exit(1);
  }
  
  console.log('');
  console.log('正在加密密码...');
  
  // 使用 bcrypt 加密密码
  const saltRounds = 10;
  const hashedPassword = await bcrypt.hash(password, saltRounds);
  
  // 读取或创建用户配置
  let users = {};
  if (fs.existsSync(usersFile)) {
    users = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
  }
  
  // 更新用户
  users[finalUsername] = {
    password: hashedPassword,
    role: 'admin',
    createdAt: new Date().toISOString()
  };
  
  // 确保目录存在
  const dataDir = path.dirname(usersFile);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  // 保存到文件
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2), 'utf-8');
  
  console.log('');
  console.log('✅ 密码设置成功！');
  console.log(`   用户名: ${finalUsername}`);
  console.log(`   配置文件: ${usersFile}`);
  console.log('');
  console.log('请重启服务使配置生效。');
  console.log('');
  
  rl.close();
  process.exit(0);
}

main().catch(error => {
  console.error('设置密码失败:', error.message);
  process.exit(1);
});
