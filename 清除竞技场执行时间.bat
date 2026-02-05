@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo     清除竞技场任务执行时间记录
echo ========================================
echo.

node clear-arena-record.js

echo.
echo 按任意键退出...
pause >nul
