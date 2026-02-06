@echo off
chcp 65001 >nul

echo 正在停止所有Node.js服务...
taskkill /f /im node.exe >nul 2>&1

if %errorlevel% equ 0 (
    echo ✓ 所有服务已停止
) else (
    echo ✓ 没有运行中的服务
)

echo.
pause
