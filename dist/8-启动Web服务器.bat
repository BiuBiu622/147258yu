@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================================
echo          启动Web服务器
echo ============================================================
echo.
echo 正在启动服务...
echo.

:: 启动静态文件服务器 (端口8080)
start "静态服务器 (8080)" /MIN cmd /k "node server\static-server.js"
timeout /t 2 /nobreak >nul

:: 启动配置API服务器 (端口3000)
start "配置API服务器 (3000)" /MIN cmd /k "node server\config-server.js"
timeout /t 2 /nobreak >nul

echo ✓ 静态文件服务器已启动 (端口: 8080)
echo ✓ 配置API服务器已启动 (端口: 3000)
echo.
echo ============================================================
echo          访问地址
echo ============================================================
echo.
echo 主页面:        http://localhost:8080
echo 账号状态:      http://localhost:8080/account-status.html
echo 监控状态:      http://localhost:8080/monitor-status.html
echo BIN文件管理:   http://localhost:8080/bin-manager.html
echo 任务配置:      http://localhost:8080/config.html
echo.
echo ============================================================
echo.
echo 按任意键打开主页面...
pause >nul
start http://localhost:8080
