@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ============================================================
echo   Antigravity 2.x Chinese Localization Patch Installer
echo ============================================================

taskkill /F /IM Antigravity.exe /T >nul 2>&1
timeout /t 2 /nobreak >nul 2>&1

set "AG_EXE=%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe"
set "AG_ASAR=%LOCALAPPDATA%\Programs\Antigravity\resources\app.asar"
set "AG_BAK=%LOCALAPPDATA%\Programs\Antigravity\resources\app.asar.bak"
set "TEMP_ASAR=%TEMP%\ag_patched_%RANDOM%.asar"

set "ELECTRON_RUN_AS_NODE=1"
"%AG_EXE%" "%~dp0scripts\patch.js" --src "%AG_ASAR%" --dest "%TEMP_ASAR%"
if errorlevel 1 goto :error

if not exist "%AG_BAK%" (
    copy /y "%AG_ASAR%" "%AG_BAK%" || goto :error
)

move /y "%TEMP_ASAR%" "%AG_ASAR%" || goto :error

echo [√] Installation succeeded.
pause
exit /b 0

:error
echo [X] Installation failed!
pause
exit /b 1
