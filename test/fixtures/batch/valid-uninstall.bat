@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ============================================================
echo   Antigravity 2.x Chinese Localization Patch Uninstaller
echo ============================================================

taskkill /F /IM Antigravity.exe /T >nul 2>&1
timeout /t 2 /nobreak >nul 2>&1

set "AG_ASAR=%LOCALAPPDATA%\Programs\Antigravity\resources\app.asar"
set "AG_BAK=%LOCALAPPDATA%\Programs\Antigravity\resources\app.asar.bak"

if not exist "%AG_BAK%" (
    echo [!] Backup app.asar.bak not found. Cannot restore.
    pause
    exit /b 1
)

copy /y "%AG_BAK%" "%AG_ASAR%" || goto :error
del /f /q "%AG_BAK%" 2>nul
del /f /q "%TEMP%\ag_patched*.asar" 2>nul

echo [√] Restoration complete.
pause
exit /b 0

:error
echo [X] Uninstallation failed!
pause
exit /b 1
