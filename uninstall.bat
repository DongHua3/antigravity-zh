@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ============================================================
echo   Google Antigravity 2.x 汉化补丁卸载程序
echo   Antigravity Chinese Localization Patch Uninstaller
echo ============================================================
echo.

rem 步骤 1: 终止运行中的 Antigravity 进程
echo [*] 正在检查并安全终止运行中的 Antigravity 进程...
taskkill /F /IM Antigravity.exe /T >nul 2>&1
set "KILL_RET=!ERRORLEVEL!"
if not "!KILL_RET!"=="0" (
    if not "!KILL_RET!"=="128" (
        echo [!] 提示: 终止进程返回代码 !KILL_RET!，若遇到占用问题请以管理员身份运行。
    )
)

echo [*] 等待系统内核释放文件句柄...
timeout /t 2 /nobreak >nul 2>&1 || ping 127.0.0.1 -n 3 >nul

rem 步骤 2: 5 级路径探测 (5-tier Path Discovery)
set "ANTIGRAVITY_EXE="
set "AG_DIR="

rem 第 1 级: 命令行参数或拖拽传入 (%~1)
if not "%~1"=="" (
    set "ARG_PATH=%~1"
    if exist "!ARG_PATH!\Antigravity.exe" (
        set "ANTIGRAVITY_EXE=!ARG_PATH!\Antigravity.exe"
    ) else if exist "!ARG_PATH!" (
        for %%I in ("!ARG_PATH!") do (
            if /i "%%~nxI"=="Antigravity.exe" (
                set "ANTIGRAVITY_EXE=%%~fI"
            ) else if exist "%%~dpIresources\app.asar" (
                set "ANTIGRAVITY_EXE=%%~dpIAntigravity.exe"
            )
        )
    )
    if defined ANTIGRAVITY_EXE (
        echo [√] 第 1 级发现: 从命令行参数检测到 Antigravity: "!ANTIGRAVITY_EXE!"
        goto :VERIFY_UNINSTALLATION
    )
)

rem 第 2 级: 默认用户目录 (%LOCALAPPDATA%\Programs\...)
if exist "%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe" (
    set "ANTIGRAVITY_EXE=%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe"
    echo [√] 第 2 级发现: 从用户安装目录检测到 Antigravity: "!ANTIGRAVITY_EXE!"
    goto :VERIFY_UNINSTALLATION
)
if exist "%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe" (
    set "ANTIGRAVITY_EXE=%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe"
    echo [√] 第 2 级发现: 从用户安装目录检测到 Antigravity: "!ANTIGRAVITY_EXE!"
    goto :VERIFY_UNINSTALLATION
)

rem 第 3 级: 注册表查询 (HKCU & HKLM Uninstall)
echo [*] 正在检索系统注册表安装记录...
for %%R in (
    "HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall"
    "HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall"
    "HKLM\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"
) do (
    if not defined ANTIGRAVITY_EXE (
        for /f "tokens=2*" %%a in ('reg query %%R /s /f "Antigravity" 2^>nul ^| findstr /i "DisplayIcon InstallLocation"') do (
            if not defined ANTIGRAVITY_EXE (
                set "RAW_REG_VAL=%%b"
                set "RAW_REG_VAL=!RAW_REG_VAL:"=!"
                set "REG_PATH="
                if exist "!RAW_REG_VAL!" (
                    set "REG_PATH=!RAW_REG_VAL!"
                ) else if exist "!RAW_REG_VAL!\Antigravity.exe" (
                    set "REG_PATH=!RAW_REG_VAL!\Antigravity.exe"
                ) else (
                    set "CANDIDATE=!RAW_REG_VAL!"
                    if "!CANDIDATE:~-2,1!"=="," set "CANDIDATE=!CANDIDATE:~0,-2!"
                    if "!CANDIDATE:~-3,1!"=="," set "CANDIDATE=!CANDIDATE:~0,-3!"
                    if exist "!CANDIDATE!" (
                        set "REG_PATH=!CANDIDATE!"
                    ) else if exist "!CANDIDATE!\Antigravity.exe" (
                        set "REG_PATH=!CANDIDATE!\Antigravity.exe"
                    )
                )
                if defined REG_PATH (
                    for %%I in ("!REG_PATH!") do (
                        if /i "%%~nxI"=="Antigravity.exe" (
                            if exist "%%~fI" (
                                set "ANTIGRAVITY_EXE=%%~fI"
                            )
                        ) else if exist "%%~fI\Antigravity.exe" (
                            set "ANTIGRAVITY_EXE=%%~fI\Antigravity.exe"
                        )
                    )
                )
            )
        )
    )
)
if defined ANTIGRAVITY_EXE (
    echo [√] 第 3 级发现: 从系统注册表检测到 Antigravity: "!ANTIGRAVITY_EXE!"
    goto :VERIFY_UNINSTALLATION
)

rem 第 4 级: 系统级 Program Files 目录
if exist "%ProgramFiles%\Antigravity\Antigravity.exe" (
    set "ANTIGRAVITY_EXE=%ProgramFiles%\Antigravity\Antigravity.exe"
    echo [√] 第 4 级发现: 从 Program Files 目录检测到 Antigravity: "!ANTIGRAVITY_EXE!"
    goto :VERIFY_UNINSTALLATION
)
if exist "%ProgramFiles(x86)%\Antigravity\Antigravity.exe" (
    set "ANTIGRAVITY_EXE=%ProgramFiles(x86)%\Antigravity\Antigravity.exe"
    echo [√] 第 4 级发现: 从 Program Files (x86) 目录检测到 Antigravity: "!ANTIGRAVITY_EXE!"
    goto :VERIFY_UNINSTALLATION
)

rem 第 5 级: 用户手动输入兜底
echo.
echo [!] 未能自动检索到 Antigravity 安装目录。
echo 请输入 Antigravity 安装目录路径，或直接拖拽 Antigravity.exe 到此窗口：
set /p "USER_INPUT_PATH=请输入路径: "
if not "!USER_INPUT_PATH!"=="" (
    set "USER_INPUT_PATH=!USER_INPUT_PATH:"=!"
    if exist "!USER_INPUT_PATH!\Antigravity.exe" (
        set "ANTIGRAVITY_EXE=!USER_INPUT_PATH!\Antigravity.exe"
    ) else if exist "!USER_INPUT_PATH!" (
        for %%I in ("!USER_INPUT_PATH!") do (
            if /i "%%~nxI"=="Antigravity.exe" (
                set "ANTIGRAVITY_EXE=%%~fI"
            ) else if exist "%%~dpIresources\app.asar" (
                set "ANTIGRAVITY_EXE=%%~dpIAntigravity.exe"
            )
        )
    )
)

:VERIFY_UNINSTALLATION
if not defined ANTIGRAVITY_EXE (
    echo [X] 错误: 未找到 Antigravity 客户端可执行文件。
    goto :error
)
if not exist "!ANTIGRAVITY_EXE!" (
    echo [X] 错误: 指定的可执行文件不存在: "!ANTIGRAVITY_EXE!"
    goto :error
)

for %%I in ("!ANTIGRAVITY_EXE!") do (
    set "ANTIGRAVITY_EXE=%%~fI"
    set "AG_DIR=%%~dpI"
)
set "RESOURCES=%AG_DIR%resources"

echo [*] 安装目录定位成功:
echo     主程序: "%ANTIGRAVITY_EXE%"
echo     资源包: "%RESOURCES%\app.asar"
echo.

rem 步骤 3: 检查备份文件存在性
if not exist "%RESOURCES%\app.asar.bak" (
    echo [!] 提示: 未在以下目录找到原始备份文件 app.asar.bak:
    echo     "%RESOURCES%\app.asar.bak"
    echo 这可能意味着当前尚未安装汉化补丁，或备份文件已被手动清除。
    echo 客户端文件未做任何更改。
    pause
    endlocal
    exit /b 1
)

rem 步骤 4: 执行无损还原
echo [*] 正在从备份恢复原始 app.asar ...
copy /y "%RESOURCES%\app.asar.bak" "%RESOURCES%\app.asar" >nul
if errorlevel 1 (
    echo [X] 错误: 还原 app.asar 失败！请检查写入权限或以管理员身份运行。
    goto :error
)
echo [√] 原始 app.asar 还原成功。

echo [*] 正在清理备份与临时文件...
del /f /q "%RESOURCES%\app.asar.bak" >nul 2>&1
del /f /q "%TEMP%\ag_patched*.asar" >nul 2>&1

if exist "%AG_DIR%version.dll" del /f /q "%AG_DIR%version.dll" >nul 2>&1
if exist "%AG_DIR%dbghelp.dll" del /f /q "%AG_DIR%dbghelp.dll" >nul 2>&1
if exist "%AG_DIR%config.json" del /f /q "%AG_DIR%config.json" >nul 2>&1

if exist "%APPDATA%\Antigravity\Code Cache" (
    echo [*] 正在清理应用字节码缓存...
    rd /s /q "%APPDATA%\Antigravity\Code Cache" >nul 2>&1
    rd /s /q "%APPDATA%\Antigravity\GPUCache" >nul 2>&1
    rd /s /q "%APPDATA%\Antigravity\Cache" >nul 2>&1
)
echo [√] 清理完成。

echo.
echo ============================================================
echo   [√] Antigravity 2.x 汉化补丁已成功卸载！
echo ============================================================
echo 客户端已完全恢复至官方原版英文状态。
echo.
pause
endlocal
exit /b 0

:error
echo.
echo ============================================================
echo   [X] 卸载未完成或遇到错误，操作已中止。
echo ============================================================
pause
endlocal
exit /b 1
