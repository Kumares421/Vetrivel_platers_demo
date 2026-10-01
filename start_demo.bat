@echo off
title Vetrivel Platers - Chemical Stores & Dispatch Portal
echo ============================================================
echo   Vetrivel Platers - Chemical Stores & Dispatch Portal
echo ============================================================
echo.

if not exist .env (
    echo Creating default .env file...
    copy .env.example .env >nul
)

if not exist node_modules (
    echo Installing npm dependencies, please wait...
    call npm install
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies. Make sure Node.js (v18+) is installed.
        pause
        exit /b 1
    )
)

echo.
echo Starting application server and frontend interface...
echo Application will be available at: http://localhost:3000
echo.
call npm run dev
pause
