@echo off
chcp 65001 >nul
title 一键混淆构建工具

echo.
echo ========================================
echo    一键混淆构建工具
echo ========================================
echo.

:: 检查 Node.js 是否安装
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js
    echo 请先安装 Node.js: https://nodejs.org/
    pause
    exit /b 1
)

:: 显示 Node.js 版本
for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo [信息] Node.js 版本: %NODE_VERSION%
echo.

:: 检查是否存在 node_modules
if not exist "node_modules\" (
    echo [警告] 未检测到 node_modules 目录
    echo [信息] 正在安装依赖...
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
    echo.
    echo [成功] 依赖安装完成
    echo.
)

:: 执行混淆构建
echo [信息] 开始执行混淆构建...
echo.
call npm run build

if %errorlevel% neq 0 (
    echo.
    echo ========================================
    echo    构建失败！
    echo ========================================
    echo.
    echo 请检查上方错误信息
    pause
    exit /b 1
)

echo.
echo ========================================
echo    构建成功完成！
echo ========================================
echo.
echo [输出目录] dist\
echo.
echo [下一步操作]
echo   1. cd dist
echo   2. npm install (首次部署需要)
echo   3. 运行 一键启动.bat 或 node server/static-server.js
echo.
echo [提示] dist 目录已包含混淆后的代码，可直接部署
echo.

pause
