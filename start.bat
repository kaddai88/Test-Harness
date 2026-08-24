@echo off
echo ============================================
echo   Test-Harness 启动脚本
echo ============================================
echo.

REM 设置 API Key（替换为你的真实 key）
set DASHSCOPE_API_KEY=%1
if "%DASHSCOPE_API_KEY%"=="" (
    echo 错误: 请提供 API Key
    echo 用法: start.bat sk-你的key
    pause
    exit /b 1
)

echo [1/3] 清理旧进程...
taskkill /F /IM node.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo [2/3] 启动服务器 (端口 4000)...
start "TestHarness-Server" cmd /k "cd /d %~dp0 && set PORT=4000 && node apps\server\th-server\dist\index.js"
timeout /t 3 /nobreak >nul

echo [3/3] 启动 Dashboard...
start "TestHarness-Dashboard" cmd /k "cd /d %~dp0 && npx pnpm --filter @test-harness/th-dashboard dev"
timeout /t 5 /nobreak >nul

echo.
echo ============================================
echo   启动完成！
echo   服务器: http://localhost:4000
echo   Dashboard: http://localhost:5173
echo ============================================
echo.
pause
