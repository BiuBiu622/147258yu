@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo       一键上传 dist 到 GitHub
echo ========================================
echo.

:: 切换到项目目录
cd /d "%~dp0"

:: 检查Git是否安装
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Git，请先安装 Git
    pause
    exit /b 1
)

:: 检查dist目录是否存在
if not exist "dist" (
    echo [错误] dist 目录不存在，请先运行构建脚本
    pause
    exit /b 1
)

:: 显示当前状态
echo [信息] 当前分支:
git branch --show-current
echo.

:: 获取提交信息
set /p commit_msg="请输入提交信息 (直接回车使用默认): "
if "!commit_msg!"=="" (
    set commit_msg=chore: update dist %date% %time:~0,8%
)

echo.
echo [步骤 1/4] 重置 dist 目录的忽略规则...

:: 创建/更新 dist 目录下的 .gitignore，排除用户数据和日志
:: ======== 敏感文件说明 ========
:: data/          - 账号数据目录（tokens.json账号、license.dat授权、配置等）
:: logs/          - 日志目录
:: *.log          - 日志文件
:: ecosystem.config.cjs - PM2 运行时配置
:: 各任务配置.json  - 可能包含账号特定执行记录
(
echo # ===== 账号敏感数据（绝对不能上传）=====
echo data/
echo.
echo # ===== BIN文件（账号转换后的二进制数据）=====
echo BIN文件/
echo.
echo # ===== 日志文件 =====
echo logs/
echo *.log
echo.
echo # ===== 运行时生成文件 =====
echo ecosystem.config.cjs
echo 服务器自动更新.sh
echo.
echo # ===== 任务执行记录（可能包含账号信息）=====
echo **/执行记录.json
echo.
echo # ===== 本地缓存 =====
echo node_modules/
) > dist\.gitignore

echo [步骤 2/4] 添加 dist 目录到暂存区（已排除敏感文件）...
git add dist -f
if %errorlevel% neq 0 (
    echo [错误] git add 失败
    pause
    exit /b 1
)

echo [步骤 3/4] 提交更改...
git commit -m "!commit_msg!"
if %errorlevel% neq 0 (
    echo [警告] 没有新的更改需要提交，或提交失败
)

echo [步骤 4/4] 推送到远程仓库...
git push -u dist main
if %errorlevel% neq 0 (
    echo [错误] git push 失败，请检查网络连接或远程仓库权限
    pause
    exit /b 1
)

echo.
echo ========================================
echo       上传完成！
echo ========================================
echo.
echo 已排除以下敏感文件:
echo   - data/             (账号tokens、授权license等)
echo   - logs/ 和 *.log    (日志文件)
echo   - ecosystem.config.cjs (PM2配置)
echo   - **/执行记录.json   (任务执行记录)
echo   - node_modules/     (依赖包)
echo.
pause
