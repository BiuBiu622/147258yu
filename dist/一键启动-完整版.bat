@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo          完整启动服务（含自动登录）
echo ========================================
echo.
echo 正在启动所有服务...
echo.

:: ========================================
:: 1. 启动Web服务和API服务
:: ========================================
echo [1/4] 启动Web服务(8080)和API服务(3000)...
start /b node server/static-server.js >nul 2>&1
start /b node server/config-server.js >nul 2>&1
timeout /t 3 /nobreak >nul
echo ✓ Web服务已启动 (8080)
echo ✓ API服务已启动 (3000)
echo.

:: ========================================
:: 2. 启动自动登录插件（后台运行）
:: ========================================
echo [2/4] 启动自动登录插件...
cd /d "%~dp0插件\游戏自动登录"
start /b node index.js >nul 2>&1
cd /d "%~dp0"
timeout /t 2 /nobreak >nul
echo ✓ 自动登录插件已启动（后台运行）
echo.

:: ========================================
:: 3. 启动调度器（前台运行，显示日志）
:: ========================================
echo [3/4] 启动调度器...
echo.
echo ========================================
echo          调度器运行日志
echo ========================================
echo.
echo 访问地址: http://119.91.226.204:8080
echo.
echo [注意] 10秒后将自动切换到控制台会话
echo 请在10秒内关闭此窗口以取消切换
echo.

:: 后台启动调度器（不阻塞）
start /b node server/scheduler.js

:: ========================================
:: 4. 先最小化窗口，然后延迟10秒后切换到控制台会话
:: ========================================
echo.
echo [4/4] 窗口将最小化，10秒后切换到控制台会话...
echo.

:: 先最小化当前窗口
powershell -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Win32 { [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); [DllImport(\"kernel32.dll\")] public static extern IntPtr GetConsoleWindow(); }'; $hwnd = [Win32]::GetConsoleWindow(); [Win32]::ShowWindow($hwnd, 6);" 2>nul

:: 如果PowerShell命令失败，使用VBScript作为备选方案
if %errorlevel% neq 0 (
  echo Set WshShell = CreateObject("WScript.Shell") > %temp%\minimize.vbs
  echo WshShell.SendKeys "%% " >> %temp%\minimize.vbs
  cscript //nologo %temp%\minimize.vbs >nul 2>&1
  del %temp%\minimize.vbs >nul 2>&1
)

echo ✓ 窗口已最小化
echo.
echo [提醒] 10秒后将自动切换到控制台会话
echo 请在10秒内关闭此窗口以取消切换
echo.

:: 延迟10秒（在最小化状态下等待）
timeout /t 10 /nobreak >nul

:: 恢复窗口显示（以便看到切换过程）
powershell -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Win32 { [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); [DllImport(\"kernel32.dll\")] public static extern IntPtr GetConsoleWindow(); }'; $hwnd = [Win32]::GetConsoleWindow(); [Win32]::ShowWindow($hwnd, 1);" 2>nul

echo.
echo ============================================
echo 切换到控制台会话（Console Session 0）
echo ============================================
echo.
echo [执行] 正在切换到控制台会话...
echo.

REM 查询当前会话ID（不使用2^>nul，以便看到错误）
set SessionID=
echo [调试] 正在查询当前会话信息...
for /f "skip=1 tokens=3" %%s in ('query user %USERNAME%') do (
  set SessionID=%%s
  echo [调试] 找到会话ID: %%s
  goto :FOUND
)

:FOUND
if "%SessionID%"=="" (
  echo ⚠️  无法获取会话ID，可能不在RDP会话中
  echo [调试] query user 命令输出：
  query user %USERNAME%
  echo.
  echo    跳过切换到控制台会话
  echo.
  echo ========================================
  echo          所有服务已启动
  echo ========================================
  echo.
  echo ✓ Web服务 (8080)
  echo ✓ API服务 (3000)
  echo ✓ 调度器（后台运行）
  echo ✓ 自动登录插件（后台运行）
  echo.
  goto :SKIP_SWITCH
)

echo 当前会话 ID: %SessionID%
echo.

REM 检查是否有管理员权限
echo [调试] 检查管理员权限...
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo ⚠️  需要管理员权限才能切换到控制台会话
  echo    请以管理员身份运行此脚本
  echo.
  echo    所有服务已启动，但未切换到控制台会话
  echo.
  goto :SKIP_SWITCH
)

echo [调试] 管理员权限检查通过
echo.

REM 切换到控制台（Session 0）- 直接执行，不隐藏错误
echo 正在执行切换...
echo [调试] 执行命令: tscon %SessionID% /dest:console
tscon %SessionID% /dest:console
set TSCON_ERROR=%errorlevel%

REM 注意：如果切换成功，RDP会立即断开，后续代码可能不会执行
REM 所以这里只记录错误，成功的话RDP会断开
if %TSCON_ERROR% neq 0 (
  echo.
  echo ⚠️  切换失败，错误代码: %TSCON_ERROR%
  echo [调试] tscon 命令详细错误信息：
  tscon %SessionID% /dest:console
  echo.
  echo    可能的原因：
  echo    - 权限不足（需要管理员权限）
  echo    - 不在RDP会话中
  echo    - 会话ID无效
  echo    - 会话已经是控制台会话
  echo.
  echo    所有服务已启动，但未切换到控制台会话
  echo    建议：手动运行"切换到控制台会话.bat"
  echo.
) else (
  REM 如果成功，RDP会断开，这行可能不会显示
  echo.
  echo ============================================
  echo 切换命令已执行！
  echo ============================================
  echo.
  echo 如果切换成功，RDP连接会立即断开
  echo 所有服务将继续在后台运行
  echo.
)

:SKIP_SWITCH

:: 等待一下让用户看到信息
timeout /t 3 /nobreak >nul

:: 再次最小化窗口（切换完成后）
powershell -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Win32 { [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); [DllImport(\"kernel32.dll\")] public static extern IntPtr GetConsoleWindow(); }'; $hwnd = [Win32]::GetConsoleWindow(); [Win32]::ShowWindow($hwnd, 6);" 2>nul

if %errorlevel% neq 0 (
  echo Set WshShell = CreateObject("WScript.Shell") > %temp%\minimize.vbs
  echo WshShell.SendKeys "%% " >> %temp%\minimize.vbs
  cscript //nologo %temp%\minimize.vbs >nul 2>&1
  del %temp%\minimize.vbs >nul 2>&1
)

echo.
echo ✓ 所有服务在后台运行
echo   如需查看日志，请查看相应的日志文件
echo.

:: 保持窗口打开但最小化（不退出，因为服务在运行）
goto :eof

