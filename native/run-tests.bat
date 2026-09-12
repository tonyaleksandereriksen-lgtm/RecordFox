@echo off
REM RekordFox - runs the native checks (DSP, device shim, engine). No sound card needed.
cd /d "%~dp0"
where cargo >nul 2>nul || (echo Rust is required - install it from https://rustup.rs then run this again. & pause & exit /b 1)
cargo --version >nul 2>nul || (rustup default stable || (echo Could not install the stable toolchain. & pause & exit /b 1))
cargo run --release --bin rfx-tests
pause
