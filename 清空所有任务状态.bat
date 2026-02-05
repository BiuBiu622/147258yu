@echo off
chcp 65001 >nul
title 清空所有任务状态
cd /d "%~dp0"

echo ========================================
echo 清空所有任务状态
echo ========================================
echo.
echo ⚠️  警告：此操作将清空所有任务的状态和记录！
echo ⚠️  清空后所有任务将重新运行！
echo.
set /p confirm=确认执行？(Y/N): 
if /i not "%confirm%"=="Y" (
    echo 已取消
    pause
    exit
)

echo.
echo 正在清空所有任务状态...
echo.

node "工具\清空所有任务状态.js"

echo.
pause





