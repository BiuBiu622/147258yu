@echo off
chcp 65001 >nul
title BIN文件转Token

cd /d "%~dp0"

echo ========================================
echo    BIN文件转Token工具
echo ========================================
echo.
echo 请确保已将BIN文件放入 BIN文件 文件夹
echo.
echo 按任意键开始转换...
pause >nul

echo.
echo 正在转换BIN文件...
echo.

node "工具\BIN转换\转换BIN.js"

echo.
echo ========================================
echo 转换完成！Token已保存到 data/tokens.json
echo ========================================
echo.
pause
