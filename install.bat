@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ============================================================
echo   Google Antigravity 2.x 汉化补丁安装程序
echo   Antigravity Chinese Localization Patch Installer
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
        goto :VERIFY_INSTALLATION
    )
)

rem 第 2 级: 默认用户目录 (%LOCALAPPDATA%\Programs\...)
if exist "%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe" (
    set "ANTIGRAVITY_EXE=%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe"
    echo [√] 第 2 级发现: 从用户安装目录检测到 Antigravity: "!ANTIGRAVITY_EXE!"
    goto :VERIFY_INSTALLATION
)
if exist "%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe" (
    set "ANTIGRAVITY_EXE=%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe"
    echo [√] 第 2 级发现: 从用户安装目录检测到 Antigravity: "!ANTIGRAVITY_EXE!"
    goto :VERIFY_INSTALLATION
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
    goto :VERIFY_INSTALLATION
)

rem 第 4 级: 系统级 Program Files 目录
if exist "%ProgramFiles%\Antigravity\Antigravity.exe" (
    set "ANTIGRAVITY_EXE=%ProgramFiles%\Antigravity\Antigravity.exe"
    echo [√] 第 4 级发现: 从 Program Files 目录检测到 Antigravity: "!ANTIGRAVITY_EXE!"
    goto :VERIFY_INSTALLATION
)
if exist "%ProgramFiles(x86)%\Antigravity\Antigravity.exe" (
    set "ANTIGRAVITY_EXE=%ProgramFiles(x86)%\Antigravity\Antigravity.exe"
    echo [√] 第 4 级发现: 从 Program Files (x86) 目录检测到 Antigravity: "!ANTIGRAVITY_EXE!"
    goto :VERIFY_INSTALLATION
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

:VERIFY_INSTALLATION
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

if not exist "%RESOURCES%\app.asar" (
    echo [X] 错误: 在资源目录未找到 app.asar:
    echo     "%RESOURCES%\app.asar"
    echo 请确认该路径为有效的 Antigravity 安装目录。
    goto :error
)

echo [*] 安装目录定位成功:
echo     主程序: "%ANTIGRAVITY_EXE%"
echo     资源包: "%RESOURCES%\app.asar"
echo.

rem 步骤 3: 两阶段补丁执行 (Stage 1 & Stage 2)
set "PATCH_SCRIPT=%~dp0scripts\patch.js"
if not exist "%PATCH_SCRIPT%" (
    echo [X] 错误: 未在补丁包中找到补丁脚本: "%PATCH_SCRIPT%"
    goto :error
)

set "TEMP_PATCHED_ASAR=%TEMP%\ag_patched.asar"
if exist "%TEMP_PATCHED_ASAR%" (
    del /f /q "%TEMP_PATCHED_ASAR%" >nul 2>&1
)

where node >nul 2>&1
if "%ERRORLEVEL%"=="0" (
    echo [*] [阶段 1/2] 检测到系统 Node.js，优先使用系统 Node.js 打包补丁...
    node "%PATCH_SCRIPT%" --src "%RESOURCES%\app.asar" --dest "%TEMP%\ag_patched.asar"
    set "NODE_EXIT_CODE=!ERRORLEVEL!"
) else (
    echo [*] [阶段 1/2] 正在调用 Antigravity 内置 Node.js 环境打包补丁...
    set "ELECTRON_RUN_AS_NODE=1"
    start /wait "" "%ANTIGRAVITY_EXE%" "%PATCH_SCRIPT%" --src "%RESOURCES%\app.asar" --dest "%TEMP%\ag_patched.asar"
    set "NODE_EXIT_CODE=!ERRORLEVEL!"
    set "ELECTRON_RUN_AS_NODE="
)

if not "%NODE_EXIT_CODE%"=="0" (
    echo [X] 错误: 补丁注入生成失败，退出码: %NODE_EXIT_CODE%
    goto :error
)

if not exist "%TEMP%\ag_patched.asar" (
    echo [X] 错误: 阶段 1 完成，但在临时目录未找到生成的文件:
    echo     "%TEMP%\ag_patched.asar"
    goto :error
)
echo [√] 阶段 1 完成: 成功生成补丁包于临时目录。
echo.

echo [*] [阶段 2/2] Node 进程已安全退出，执行原子备份与替换...
if not exist "%RESOURCES%\app.asar.bak" (
    echo [*] 正在备份原始 app.asar 到 app.asar.bak ...
    copy /y "%RESOURCES%\app.asar" "%RESOURCES%\app.asar.bak" >nul
    if errorlevel 1 (
        echo [X] 错误: 备份 app.asar 失败！请检查写入权限或以管理员身份运行。
        goto :error
    )
    echo [√] 原始备份已就绪: "%RESOURCES%\app.asar.bak"
) else (
    echo [*] 已存在原始备份，保留初始版本: "%RESOURCES%\app.asar.bak"
)

echo [*] 正在写入汉化补丁文件...
move /y "%TEMP%\ag_patched.asar" "%RESOURCES%\app.asar" >nul
if errorlevel 1 (
    echo [X] 错误: 替换 app.asar 失败！文件可能仍被其他进程锁定，请以管理员身份重试。
    goto :error
)

echo.
echo ============================================================
echo   [√] Antigravity 2.x 汉化补丁安装成功！
echo ============================================================
echo 您现在可以正常启动 Antigravity 客户端体验中文界面。
echo 如需恢复英文原版，请随时运行 uninstall.bat 进行无损还原。
echo.
pause
endlocal
exit /b 0

:error
echo.
echo ============================================================
echo   [X] 安装未完成或遇到错误，操作已中止。
echo ============================================================
if exist "%TEMP%\ag_patched.asar" (
    del /f /q "%TEMP%\ag_patched.asar" >nul 2>&1
)
pause
endlocal
exit /b 1
