@echo off
chcp 65001 >nul
title 游戏自动登录挂机插件
cd /d "%~dp0"

echo ========================================
echo   游戏自动登录挂机插件
echo ========================================
echo.
echo 正在启动...
echo.
node index.js
echo.
pause
