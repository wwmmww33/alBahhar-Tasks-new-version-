@echo off
setlocal enabledelayedexpansion
title Bahar App Updater

:: Re-launch elevated if not running as Administrator
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /B
)

set NSSM=C:\Apps\Bahar\nssm.exe
set DEST=C:\Apps\Bahar\bahar.exe
set SOURCE=\\tsclient\C\bahar\bahar.exe
set BACKUP_DIR=C:\Apps\Bahar\backups

cls
echo.
echo  ============================================
echo    Bahar App Updater
echo  ============================================
echo.

if not exist "%NSSM%" (
    echo  ERROR: nssm.exe not found at:
    echo         %NSSM%
    pause
    exit /B 1
)

echo  [1/4]  Stopping BaharApp...
"%NSSM%" stop BaharApp
timeout /t 2 /nobreak >nul
echo         OK.

echo.
echo  [2/4]  Backing up current bahar.exe...
if exist "%DEST%" (
    if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
    set /a NEXT_VER=1
    :find_next_ver
    if exist "%BACKUP_DIR%\bahar_v!NEXT_VER!.exe" (
        set /a NEXT_VER+=1
        goto find_next_ver
    )
    copy /Y "%DEST%" "%BACKUP_DIR%\bahar_v!NEXT_VER!.exe" >nul
    echo         Saved as: backups\bahar_v!NEXT_VER!.exe
) else (
    echo         No existing file to backup - skipping.
)

echo.
echo  [3/4]  Copying bahar.exe from local machine...
if not exist "%SOURCE%" (
    echo.
    echo  ERROR: File not found: %SOURCE%
    echo.
    echo  Make sure bahar.exe is in  c:\bahar  on your local machine.
    echo.
    echo  Restarting old version...
    "%NSSM%" start BaharApp >nul 2>&1
    pause
    exit /B 1
)

copy /Y "%SOURCE%" "%DEST%" >nul
if %errorlevel% neq 0 (
    echo  ERROR: Copy failed.
    "%NSSM%" start BaharApp >nul 2>&1
    pause
    exit /B 1
)
echo         OK - File replaced.

echo.
echo  [4/4]  Starting BaharApp...
"%NSSM%" start BaharApp
echo         OK.

echo.
echo  ============================================
echo    Done! App updated successfully.
echo  ============================================
echo.
timeout /t 4 /nobreak >nul
exit /B 0
