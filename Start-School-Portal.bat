@echo off
setlocal
cd /d "%~dp0"
title EduCore School Management Portal

echo ======================================================================
echo           EduCore Pro - School Management Portal (Offline Mode)
echo ======================================================================
echo.

where node >nul 2>nul
if %errorlevel% equ 0 (
    echo [OK] Starting local offline server on port 3000...
    echo [OK] Opening School Portal in your default browser...
    start http://localhost:3000
    echo.
    echo ======================================================================
    echo   Portal is LIVE at: http://localhost:3000
    echo   Keep this small window open while working.
    echo   Close this window when your school day ends.
    echo ======================================================================
    echo.
    node server.js
    goto end
)

where python >nul 2>nul
if %errorlevel% equ 0 (
    echo [OK] Python detected. Starting offline server...
    start http://localhost:3000
    python -m http.server 3000
    goto end
)

echo [!] Neither Node.js nor Python was detected.
echo To run this portal completely offline on your PC:
echo 1. Install Node.js (Free, 2-minute install): https://nodejs.org
echo 2. Once installed, double-click this Start-School-Portal.bat file again!
echo.
pause

:end
