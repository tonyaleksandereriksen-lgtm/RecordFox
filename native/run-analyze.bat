@echo off
REM RekordFox - analyses tracks the way the library will on import: BPM, downbeat, key, waveform.
REM Drag a file or a folder onto this file, or run it and type a path.
cd /d "%~dp0"
where cargo >nul 2>nul || (echo Rust is required - install it from https://rustup.rs then run this again. & pause & exit /b 1)
cargo --version >nul 2>nul || (rustup default stable || (echo Could not install the stable toolchain. & pause & exit /b 1))

set "TARGET=%~1"
if "%TARGET%"=="" set /p TARGET=Folder or file to analyse (WAV, MP3, FLAC):
if "%TARGET%"=="" (echo Nothing to analyse. & pause & exit /b 1)

cargo run --release --bin rfx-analyze -- --out "%~dp0analysis.json" "%TARGET%"
if errorlevel 1 (echo. & echo Analysis failed. & pause & exit /b 1)
echo.
echo Results also written to "%~dp0analysis.json"
pause
