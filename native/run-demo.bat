@echo off
REM RekordFox - plays audio through the DDJ-FLX2 with the native engine.
REM Drag one or two audio files onto this file, or pass them on the command line.
cd /d "%~dp0"
where cargo >nul 2>nul || (echo Rust is required - install it from https://rustup.rs then run this again. & pause & exit /b 1)
cargo --version >nul 2>nul || (rustup default stable || (echo Could not install the stable toolchain. & pause & exit /b 1))
if "%~1"=="" (
  set /p TRACKA=Path to an audio file (wav, flac or mp3): 
  set /p TRACKB=Second file for the crossfade (optional, press Enter to skip): 
) else (
  set TRACKA=%~1
  set TRACKB=%~2
)
echo Building...
if "%TRACKB%"=="" (
  cargo run --release --bin rfx-demo -- "%TRACKA%"
) else (
  cargo run --release --bin rfx-demo -- "%TRACKA%" "%TRACKB%"
)
if errorlevel 1 pause
