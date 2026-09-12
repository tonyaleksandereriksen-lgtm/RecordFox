@echo off
REM RekordFox - development: Vite dev server with hot reload, opens in the browser.
cd /d "%~dp0"
if not exist node_modules\vite (
  call npm install || (pause & exit /b 1)
)
call npx vite --open
