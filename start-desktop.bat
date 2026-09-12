@echo off
REM RekordFox - desktop app (Electron). First run installs dependencies; every run rebuilds from source.
cd /d "%~dp0"
where npm >nul 2>nul || (echo Node.js 22 or newer is required: https://nodejs.org & pause & exit /b 1)
if not exist node_modules\electron (
  echo Installing dependencies - one time only...
  call npm install || (pause & exit /b 1)
)
if not exist native
odefx.node (
  echo Building the audio engine - one time only, needs Rust and the MSVC build tools, see native\README.md...
  call npm run native || (echo The audio engine did not build. The app will start without audio. & pause)
)
echo Building RekordFox...
call npm run build || (echo Build failed - starting the last good build instead.)
call npx electron .
