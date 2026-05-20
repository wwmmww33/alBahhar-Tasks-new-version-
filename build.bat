@echo off
chcp 65001 > nul
echo.
echo ==========================================
echo   Bahar - Build EXE
echo ==========================================
echo.

:: التحقق من وجود Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo [خطأ] Node.js غير مثبت. حمّله من https://nodejs.org
    pause
    exit /b 1
)

:: ===== الخطوة 1: بناء الواجهة الأمامية =====
echo [1/3] بناء الواجهة الأمامية (React)...
cd /d "%~dp0client"
if not exist node_modules (
    echo     تثبيت الحزم...
    call npm install
    if errorlevel 1 ( echo [خطأ] فشل npm install في client & pause & exit /b 1 )
)
call npm run build
if errorlevel 1 ( echo [خطأ] فشل بناء الواجهة & pause & exit /b 1 )
echo     تم بناء الواجهة بنجاح.
echo.

:: ===== الخطوة 2: تجميع الخادم =====
echo [2/3] تجميع الخادم (Node.js)...
cd /d "%~dp0server"
if not exist node_modules (
    echo     تثبيت الحزم...
    call npm install
    if errorlevel 1 ( echo [خطأ] فشل npm install في server & pause & exit /b 1 )
)
call node build.mjs
if errorlevel 1 ( echo [خطأ] فشل تجميع الخادم & pause & exit /b 1 )
echo     تم التجميع بنجاح.
echo.

:: ===== الخطوة 3: إنشاء EXE =====
echo [3/3] إنشاء ملف bahar.exe...
call npx @yao-pkg/pkg bundle.js --targets node18-win-x64 --output release/bahar.exe
if errorlevel 1 ( echo [خطأ] فشل إنشاء EXE & pause & exit /b 1 )
echo     تم إنشاء EXE بنجاح.
echo.

echo ==========================================
echo   النتيجة:
echo   server\release\bahar.exe
echo   server\release\dist\
echo   server\release\.env
echo.
echo   انقل مجلد release\ إلى أي جهاز وشغّل bahar.exe
echo ==========================================
echo.
pause
