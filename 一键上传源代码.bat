@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo       一键上传 源代码 到 GitHub
echo ========================================
echo.

:: 切换到项目目录
cd /d "%~dp0"

:: 检查Git是否安装
where git >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Git，请先安装 Git
    pause
    exit /b 1
)

:: 显示当前状态
echo [信息] 当前分支:
git branch --show-current
echo.

:: 获取提交信息
set /p commit_msg="请输入源代码提交信息 (直接回车使用帮助说明): "
if "!commit_msg!"=="" (
    set commit_msg=feat: update source code %date% %time:~0,8%
)

echo.
echo [步骤 1/3] 添加所有文件及忽略规则处理...
:: 特别注意：这里直接 add . 会遵循主目录的 .gitignore
git add .
if %errorlevel% neq 0 (
    echo [错误] git add 失败
    pause
    exit /b 1
)

echo [步骤 2/3] 提交更改...
git commit -m "!commit_msg!"
if %errorlevel% neq 0 (
    echo [警告] 没有新的更改需要提交，或提交失败
)

echo [步骤 3/3] 推送到远程仓库...
:: 自动设置上游分支并推送到 source 仓库
git push -u source main
if %errorlevel% neq 0 (
    echo [错误] git push 失败，请检查网络连接或远程仓库权限
    pause
    exit /b 1
)

echo.
echo ========================================
echo       源代码上传完成！
echo ========================================
echo 已根据 .gitignore 自动排除敏感目录(data, BIN文件, logs等)
echo.
pause
