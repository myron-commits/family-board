@echo off
title Family Board setup
cd /d "%~dp0"
echo Installing (about a minute)...
call npm install
if errorlevel 1 goto fail
call npm run setup
if errorlevel 1 goto fail
echo.
echo All done. You can close this window.
pause
exit /b 0
:fail
echo.
echo Setup stopped with an error. Leave this window open so Claude can read it.
pause
