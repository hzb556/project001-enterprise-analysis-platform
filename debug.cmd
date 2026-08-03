@echo off
chcp 65001 >nul
echo ================================
echo   企业运营分析平台 — 调试模式
echo ================================
echo.

:: 1. 启动 Flask
echo [1/3] 启动 Flask 后端...
start "Flask" cmd /c "cd /d %~dp0src && python app.py"

:: 等待 Flask 就绪
echo [2/3] 等待 Flask 就绪...
:wait
timeout /t 1 /nobreak >nul
curl -s http://localhost:5000/api/auth/me >nul 2>&1
if errorlevel 1 goto wait
echo          Flask 已就绪: http://localhost:5000

:: 2. 启动 Intent Browser
echo [3/3] 启动 Intent Browser...
start "IntentBrowser" cmd /c "cd /d D:\AI项目\intent-browser && node bin\intent-browser.js http://localhost:5000 --port 17345 --out diffs.ndjson"

echo.
echo   ✅ 全部就绪
echo   Flask:          http://localhost:5000
echo   IntentBrowser:  http://127.0.0.1:17345
echo.
echo   关闭此窗口即可停止所有服务
echo ================================
pause >nul
