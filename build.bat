@echo off
echo.
echo ==========================================
echo   Bahar - Build EXE
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
echo [1/3] Building frontend (React)...
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

:: ===== Step 2: Bundle Server =====
echo [2/3] Bundling server (Node.js)...
cd /d "%~dp0server"
if not exist node_modules (
    echo     Installing packages...
    call npm install
    if errorlevel 1 ( echo [ERROR] npm install failed in server & pause & exit /b 1 )
)
call node build.mjs
if errorlevel 1 ( echo [ERROR] Server bundle failed & pause & exit /b 1 )
echo     Server bundled successfully.
echo.

:: ===== Step 3: Create EXE =====
echo [3/3] Creating bahar.exe...
call npx @yao-pkg/pkg bundle.js --targets node18-win-x64 --output release/bahar.exe
if errorlevel 1 ( echo [ERROR] EXE creation failed & pause & exit /b 1 )
echo     bahar.exe created successfully.
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
