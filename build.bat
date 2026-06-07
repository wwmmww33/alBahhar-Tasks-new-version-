@echo off
echo.
echo ==========================================
echo   Bahar - Build EXE (Node.js SEA)
echo ==========================================
echo.

:: Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed.
    pause
    exit /b 1
)

:: ===== Step 1: Build Frontend =====
echo [1/2] Building frontend (React)...
cd /d "%~dp0client"
if not exist node_modules (
    echo     Installing packages...
    call npm install
    if errorlevel 1 ( echo [ERROR] npm install failed in client & pause & exit /b 1 )
)
call npm run build
if errorlevel 1 ( echo [ERROR] Frontend build failed & pause & exit /b 1 )
echo     Frontend built successfully.
echo.

:: ===== Step 2: Bundle Server + Create EXE =====
echo [2/2] Bundling server and creating bahar.exe (Node.js SEA)...
cd /d "%~dp0server"
if not exist node_modules (
    echo     Installing packages...
    call npm install
    if errorlevel 1 ( echo [ERROR] npm install failed in server & pause & exit /b 1 )
)
call node --max-old-space-size=4096 build.mjs
if errorlevel 1 ( echo [ERROR] Build or EXE creation failed & pause & exit /b 1 )
echo.

echo ==========================================
echo   Output:
echo   server\release\bahar.exe
echo   server\release\.env
echo.
echo   Copy the release\ folder to any machine and run bahar.exe
echo ==========================================
echo.
pause
