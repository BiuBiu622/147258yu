@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo          启动服务
echo ========================================
echo.
echo 正在启动Web服务(8080)、API服务(3000)和调度器...
echo.

:: 启动静态服务器
start /b node server/static-server.js >nul 2>&1

:: 启动配置API服务器
start /b node server/config-server.js >nul 2>&1

timeout /t 3 /nobreak >nul

echo ✓ Web服务已启动 (8080)
echo ✓ API服务已启动 (3000)
echo ✓ 调度器已启动
echo.
echo 访问地址: http://119.91.226.204:8080
echo.
echo ========================================
echo          调度器运行日志
echo ========================================
echo.

:: 前台运行调度器，显示日志
node server/scheduler.js
