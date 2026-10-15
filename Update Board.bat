@echo off
title Family Board update
cd /d "%~dp0"
echo Putting the latest version online...
call npx wrangler deploy
echo.
echo Done. Refresh the board to see the changes.
pause
