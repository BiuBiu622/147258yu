@echo off
chcp 65001 >nul
echo ========================================
echo   授权系统客户端清理脚本
echo   用于发布前删除管理端相关文件
echo ========================================
echo.

echo [1/3] 正在删除独立管理端目录...
if exist "独立管理端" (
    rd /s /q "独立管理端"
    echo ✓ 已删除: 独立管理端\
) else (
    echo ⚠ 目录不存在: 独立管理端\
)

echo.
echo [2/3] 正在删除授权码数据库...
if exist "数据\all_licenses.json" (
    del /f /q "数据\all_licenses.json"
    echo ✓ 已删除: 数据\all_licenses.json
) else (
    echo ⚠ 文件不存在: 数据\all_licenses.json
)

echo.
echo [3/3] 验证保留文件...
set MISSING=0

if not exist "核心\授权API.js" (
    echo ✗ 缺失: 核心\授权API.js
    set MISSING=1
)
if not exist "核心\授权验证.js" (
    echo ✗ 缺失: 核心\授权验证.js
    set MISSING=1
)
if not exist "核心\授权加密.js" (
    echo ✗ 缺失: 核心\授权加密.js
    set MISSING=1
)
if not exist "核心\机器码生成.js" (
    echo ✗ 缺失: 核心\机器码生成.js
    set MISSING=1
)

if %MISSING%==0 (
    echo ✓ 所有必需文件完整
) else (
    echo.
    echo ⚠ 警告：部分必需文件缺失！
)

echo.
echo ========================================
echo   清理完成！
echo ========================================
echo.
echo 已删除的文件：
echo   - 独立管理端\ (整个目录)
echo   - 数据\all_licenses.json
echo.
echo 保留的文件：
echo   - 核心\ (授权验证模块)
echo   - 数据\license.dat (激活状态)
echo   - Web界面\ (激活页面样式)
echo.
echo 现在可以安全地将程序发布给用户了！
echo.
pause
