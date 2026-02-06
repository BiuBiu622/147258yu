/**
 * 日志工具 - 使用ASCII字符避免乱码
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ANSI颜色代码
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m'
};

// 日志目录
const logsDir = path.join(__dirname, '../logs');

// 初始化日志目录
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// 当前日志文件
let currentLogFile = null;
let currentDate = null;

function getTimestamp() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const second = String(now.getSeconds()).padStart(2, '0');
  return `[${year}/${month}/${day} ${hour}:${minute}:${second}]`;
}

function getDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLogFile() {
  const today = getDateString();
  
  // 如果日期变了，创建新的日志文件
  if (currentDate !== today) {
    currentDate = today;
    currentLogFile = path.join(logsDir, `${today}.log`);
  }
  
  return currentLogFile;
}

function writeToFile(message) {
  try {
    const logFile = getLogFile();
    // 移除ANSI颜色代码
    const cleanMessage = message.replace(/\x1b\[[0-9;]*m/g, '');
    fs.appendFileSync(logFile, cleanMessage + '\n', 'utf-8');
  } catch (error) {
    // 静默失败，不影响控制台输出
  }
}

export function 成功日志(...args) {
  const message = `${colors.gray}${getTimestamp()}${colors.reset} ${colors.green}[OK]${colors.reset} ${args.join(' ')}`;
  console.log(message);
  writeToFile(`${getTimestamp()} [OK] ${args.join(' ')}`);
}

export function 错误日志(...args) {
  const message = `${colors.gray}${getTimestamp()}${colors.reset} ${colors.red}[ERROR]${colors.reset} ${args.join(' ')}`;
  console.log(message);
  writeToFile(`${getTimestamp()} [ERROR] ${args.join(' ')}`);
}

export function 警告日志(...args) {
  const message = `${colors.gray}${getTimestamp()}${colors.reset} ${colors.yellow}[WARN]${colors.reset} ${args.join(' ')}`;
  console.log(message);
  writeToFile(`${getTimestamp()} [WARN] ${args.join(' ')}`);
}

export function 信息日志(...args) {
  const message = `${colors.gray}${getTimestamp()}${colors.reset} ${colors.blue}[INFO]${colors.reset} ${args.join(' ')}`;
  console.log(message);
  writeToFile(`${getTimestamp()} [INFO] ${args.join(' ')}`);
}

// 清理旧日志（保留最近3天）
export function 清理过期日志() {
  try {
    const files = fs.readdirSync(logsDir);
    const now = new Date();
    const keepDays = 3; // ✅ 保留3天
    
    let deletedCount = 0;
    files.forEach(file => {
      if (!file.endsWith('.log')) return;
      
      // 解析文件名中的日期 (YYYY-MM-DD.log)
      const dateMatch = file.match(/(\d{4}-\d{2}-\d{2})\.log/);
      if (!dateMatch) return;
      
      const fileDate = new Date(dateMatch[1]);
      const daysDiff = Math.floor((now - fileDate) / (24 * 60 * 60 * 1000));
      
      // 删除超过3天的日志
      if (daysDiff > keepDays) {
        const filePath = path.join(logsDir, file);
        fs.unlinkSync(filePath);
        console.log(`${colors.gray}${getTimestamp()}${colors.reset} ${colors.yellow}[CLEAN]${colors.reset} 已删除旧日志: ${file} (距离${daysDiff}天)`);
        deletedCount++;
      }
    });
    
    if (deletedCount > 0) {
      console.log(`${colors.gray}${getTimestamp()}${colors.reset} ${colors.green}[OK]${colors.reset} 清理完成，共删除 ${deletedCount} 个超过${keepDays}天的日志文件`);
    }
  } catch (error) {
    console.error('清理日志失败:', error.message);
  }
}
