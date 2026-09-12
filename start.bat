@echo off
REM RekordFox - run in Chrome/Edge. Rebuilds first when the dev tools are installed, so the app matches the source.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 22 or newer is required: https://nodejs.org & pause & exit /b 1)
if exist node_modules\vite (
  echo Building RekordFox...
  call npm run build || (echo Build failed - starting the last good build instead.)
)
node serve.mjs --open
pause
