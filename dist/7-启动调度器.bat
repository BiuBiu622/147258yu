@echo off
chcp 65001 >nul
title 启动调度器
cd /d "%~dp0"

echo ========================================
echo 启动任务调度器
echo ========================================
echo.
:start
echo 调度器正在启动...
echo 按 Ctrl+C 可以停止调度器
echo.
node "server\scheduler.js"
echo.
echo 调度器已停止，3秒后自动重启...
timeout /t 3 >nul
goto start
