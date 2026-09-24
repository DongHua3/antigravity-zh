@echo off
chcp 65001 >nul
set AG_ASAR=C:\Program Files\Antigravity\resources\app.asar
copy /y %AG_ASAR% %AG_BAK%
pause
