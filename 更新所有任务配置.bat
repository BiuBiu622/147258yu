@echo off
chcp 65001 >nul
cd /d %~dp0
echo ========================================
echo    一键更新所有任务配置
echo ========================================
echo.

echo [1/8] 同步账号配置，添加所有任务字段...
node update-task-config.js 1
if errorlevel 1 goto :error

echo.
echo [2/8] 补全竞技场战斗次数配置...
node update-task-config.js 2
if errorlevel 1 goto :error

echo.
echo [3/8] 补全俱乐部签到配置...
node update-task-config.js 3
if errorlevel 1 goto :error

echo.
echo [4/8] 补全梦境任务配置...
node update-task-config.js 4
if errorlevel 1 goto :error

echo.
echo [5/8] 补全灯神任务配置...
node update-task-config.js 5
if errorlevel 1 goto :error

echo.
echo [6/8] 补全咸将塔任务配置...
node update-task-config.js 6
if errorlevel 1 goto :error

echo.
echo [7/8] 验证配置文件完整性...
node update-task-config.js 7
if errorlevel 1 goto :error

echo.
echo [8/8] 检查Web页面文件...
node update-task-config.js 8
if errorlevel 1 goto :error

echo.
echo ========================================
echo    更新完成！
echo ========================================
echo.
pause
exit /b 0

:error
echo.
echo 错误: 执行失败
pause
exit /b 1

