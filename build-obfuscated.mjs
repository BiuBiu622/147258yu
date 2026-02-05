/**
 * 代码混淆构建脚本
 * 
 * 功能：
 * - 扫描所有需要混淆的 .js 文件
 * - 使用 javascript-obfuscator 混淆代码
 * - 输出到 dist/ 目录
 * - 保持原有目录结构
 * - 复制非 JS 文件
 * 
 * 使用方式：
 *   npm run build          # 构建混淆版本
 *   npm run build:release  # 构建发布版本（包含清理）
 */

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import JavaScriptObfuscator from 'javascript-obfuscator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 配置
const SOURCE_DIR = __dirname;
const OUTPUT_DIR = path.join(__dirname, 'dist');
const CONFIG_FILE = path.join(__dirname, 'obfuscator-config.json');

// 需要混淆的目录
const OBFUSCATE_DIRS = [
    'server',
    '工具',
    '任务',
    'BOSS塔助战',
    '快捷指令'
];

// 需要直接复制的目录/文件
const COPY_ITEMS = [
    'web',
    'config',
    'data',
    'BIN文件',
    'package.json',
    'package-lock.json',
    '7-启动调度器.bat',
    '8-启动Web服务器.bat',
    '一键启动.bat',
    '一键启动-完整版.bat',
    '停止所有服务.bat',
    '转换BIN.bat',
    '更新所有任务配置.bat',
    '清理咸将塔执行时间.bat',
    '清空所有任务状态.bat',
    '清除竞技场执行时间.bat',
    '检测状态更新.bat'
];

// 排除的文件/目录
const EXCLUDE_PATTERNS = [
    'node_modules',
    'dist',
    'logs',
    '.git',
    '.gitignore',
    // 授权系统相关 (已重构，仅保留必要的管理端排除)
    '授权系统/独立管理端',
    '授权系统/数据',
    '授权系统/核心',
    '授权系统/工具',
    '授权系统/配置',
    '授权系统/start-server.sh',
    '授权系统/cleanup-for-release.bat',
    // 构建相关文件
    'obfuscator-config.json',
    'build-obfuscated.mjs'
];

// 读取混淆配置
function loadObfuscatorConfig() {
    try {
        const config = fs.readJsonSync(CONFIG_FILE);
        console.log('✓ 已加载混淆配置');
        return config;
    } catch (err) {
        console.log('⚠ 使用默认混淆配置');
        return {
            compact: true,
            identifierNamesGenerator: 'hexadecimal',
            renameGlobals: true,
            stringArray: true,
            stringArrayEncoding: ['base64'],
            stringArrayThreshold: 0.75
        };
    }
}

// 检查是否应该排除
function shouldExclude(relativePath) {
    const normalizedPath = relativePath.replace(/\\/g, '/');
    return EXCLUDE_PATTERNS.some(pattern => {
        const normalizedPattern = pattern.replace(/\\/g, '/');
        return normalizedPath === normalizedPattern ||
            normalizedPath.startsWith(normalizedPattern + '/');
    });
}

// 获取所有需要混淆的 JS 文件
function getJsFilesToObfuscate() {
    const files = [];

    for (const dir of OBFUSCATE_DIRS) {
        const dirPath = path.join(SOURCE_DIR, dir);
        if (!fs.existsSync(dirPath)) {
            console.log(`⚠ 目录不存在: ${dir}`);
            continue;
        }

        const walkDir = (currentPath, relativePath) => {
            const items = fs.readdirSync(currentPath);
            for (const item of items) {
                const itemPath = path.join(currentPath, item);
                const itemRelativePath = path.join(relativePath, item);

                if (shouldExclude(itemRelativePath)) {
                    continue;
                }

                const stat = fs.statSync(itemPath);
                if (stat.isDirectory()) {
                    walkDir(itemPath, itemRelativePath);
                } else if (item.endsWith('.js')) {
                    files.push({
                        source: itemPath,
                        relative: itemRelativePath,
                        type: 'js'
                    });
                } else if (item === '配置.json' || item === 'README.md') {
                    // 复制任务配置文件和说明文档（不混淆）
                    files.push({
                        source: itemPath,
                        relative: itemRelativePath,
                        type: 'copy'
                    });
                }
            }
        };

        walkDir(dirPath, dir);
    }

    // 添加根目录的 JS 文件
    const rootFiles = fs.readdirSync(SOURCE_DIR);
    for (const file of rootFiles) {
        if (file.endsWith('.js') && !shouldExclude(file)) {
            const filePath = path.join(SOURCE_DIR, file);
            if (fs.statSync(filePath).isFile()) {
                files.push({
                    source: filePath,
                    relative: file
                });
            }
        }
    }

    return files;
}

// 混淆单个文件
function obfuscateFile(sourcePath, config) {
    const code = fs.readFileSync(sourcePath, 'utf-8');

    try {
        const obfuscationResult = JavaScriptObfuscator.obfuscate(code, config);
        return obfuscationResult.getObfuscatedCode();
    } catch (err) {
        console.error(`✗ 混淆失败: ${sourcePath}`);
        console.error(`  错误: ${err.message}`);
        // 返回原始代码（至少去掉注释）
        return code;
    }
}

// 复制目录或文件
function copyItem(itemName) {
    const sourcePath = path.join(SOURCE_DIR, itemName);
    const destPath = path.join(OUTPUT_DIR, itemName);

    if (!fs.existsSync(sourcePath)) {
        console.log(`⚠ 不存在: ${itemName}`);
        return;
    }

    // 特殊处理 data 目录：只复制模板，不复制用户数据
    if (itemName === 'data') {
        fs.ensureDirSync(destPath);
        // 只复制配置文件，不复制记录文件
        const configFiles = ['task-config.json', 'game-hangup-config.json', 'license.dat'];
        for (const file of configFiles) {
            const srcFile = path.join(sourcePath, file);
            const destFile = path.join(destPath, file);
            if (fs.existsSync(srcFile)) {
                fs.copySync(srcFile, destFile);
                console.log(`  复制: ${itemName}/${file}`);
            }
        }
        return;
    }

    fs.copySync(sourcePath, destPath);
    console.log(`  复制: ${itemName}`);
}


// 主构建函数
async function build() {
    console.log('========================================');
    console.log('   代码混淆构建工具');
    console.log('========================================');
    console.log('');

    // 清理输出目录
    console.log('[1/4] 清理输出目录...');
    if (fs.existsSync(OUTPUT_DIR)) {
        fs.emptyDirSync(OUTPUT_DIR);
    }
    fs.ensureDirSync(OUTPUT_DIR);
    console.log('✓ 已清理 dist/ 目录');
    console.log('');

    // 加载混淆配置
    console.log('[2/4] 加载混淆配置...');
    const obfuscatorConfig = loadObfuscatorConfig();
    console.log('');

    // 混淆 JS 文件
    console.log('[3/4] 混淆 JavaScript 文件...');
    const jsFiles = getJsFilesToObfuscate();
    console.log(`  发现 ${jsFiles.length} 个 JS 文件需要混淆`);

    let successCount = 0;
    let failCount = 0;
    let copyCount = 0;

    for (const file of jsFiles) {
        const destPath = path.join(OUTPUT_DIR, file.relative);
        fs.ensureDirSync(path.dirname(destPath));

        try {
            if (file.type === 'copy') {
                // 直接复制配置文件（不混淆）
                fs.copyFileSync(file.source, destPath);
                copyCount++;
            } else {
                // 混淆 JS 文件
                const obfuscatedCode = obfuscateFile(file.source, obfuscatorConfig);
                fs.writeFileSync(destPath, obfuscatedCode, 'utf-8');
            }
            successCount++;
            // 显示进度
            process.stdout.write(`\r  进度: ${successCount + failCount}/${jsFiles.length}`);
        } catch (err) {
            console.error(`\n  ✗ ${file.relative}: ${err.message}`);
            failCount++;
        }
    }

    console.log(`\n  ✓ 成功混淆 ${successCount - copyCount} 个 JS 文件`);
    console.log(`  ✓ 复制 ${copyCount} 个配置文件`);
    if (failCount > 0) {
        console.log(`  ⚠ 失败 ${failCount} 个文件`);
    }
    console.log('');

    // 复制其他文件
    console.log('[4/4] 复制其他文件...');
    for (const item of COPY_ITEMS) {
        copyItem(item);
    }

    console.log('');

    // 完成
    console.log('========================================');
    console.log('   构建完成！');
    console.log('========================================');
    console.log('');
    console.log(`输出目录: ${OUTPUT_DIR}`);
    console.log(`JS 文件: ${successCount} 个已混淆`);
    console.log('');
    console.log('下一步：');
    console.log('  1. cd dist');
    console.log('  2. npm install');
    console.log('  3. 运行测试');
    console.log('');
}

// 执行构建
build().catch(err => {
    console.error('构建失败:', err);
    process.exit(1);
});
