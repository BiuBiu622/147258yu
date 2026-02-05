@echo off
chcp 65001 >nul
title 清理咸将塔执行时间
cd /d "%~dp0"

echo ========================================
echo 清理咸将塔执行时间记录
echo ========================================
echo.
echo 此操作将清除"咸将塔"任务的执行时间记录
echo 清除后调度器将在下次检测时重新执行该任务
echo.
set /p confirm=确认执行？(Y/N): 
if /i not "%confirm%"=="Y" (
    echo 已取消
    pause
    exit
)

echo.
echo 正在清理"咸将塔"执行时间记录...
echo.

node "快捷指令\清理咸将塔执行时间.js"

echo.
pause

