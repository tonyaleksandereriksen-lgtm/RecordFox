@echo off
REM RekordFox - native audio probe. Needs Rust (https://rustup.rs) and the MSVC build tools.
cd /d "%~dp0"
where rustup >nul 2>nul || (echo Rust is required - install it from https://rustup.rs then run this again. & pause & exit /b 1)
REM A fresh rustup install has no default toolchain, so cargo refuses to run. Set one up.
cargo --version >nul 2>nul || (
  echo No Rust toolchain selected yet - installing the stable one, this takes a minute...
  rustup default stable || (echo Could not install the stable toolchain. & pause & exit /b 1)
)
cargo --version >nul 2>nul || (echo Cargo still is not working - close this window, open a new one and try again. & pause & exit /b 1)
echo Building the probe (first run takes a minute)...
cargo run --release
if errorlevel 1 (
  echo.
  echo The build or the probe failed. If it says "link.exe not found" or "msvc", install the
  echo Visual Studio Build Tools with the "Desktop development with C++" workload:
  echo   https://visualstudio.microsoft.com/visual-cpp-build-tools/
  echo Then run this again. Anything else: copy the message above into the chat.
)
pause
