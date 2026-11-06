@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Download the LTS version from https://nodejs.org , install it, then run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  call npm install
  if errorlevel 1 (
    echo The install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)
rem Newer npm versions block Electron's own download step, so run it directly.
set "ELECTRON_SKIP_BINARY_DOWNLOAD="
set "ELECTRON_OVERRIDE_DIST_PATH="
if not exist "node_modules\electron\dist\electron.exe" (
  if exist "node_modules\electron\dist" rmdir /s /q "node_modules\electron\dist"
  if exist "node_modules\electron\path.txt" del /f /q "node_modules\electron\path.txt"
  call node node_modules\electron\install.js
  if errorlevel 1 (
    echo The Electron download failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)
if not exist "node_modules\electron-builder\package.json" (
  echo Installing the packaging tool, only needed for building the exe...
  call npm install --no-save --ignore-scripts electron-builder@25.1.8
  if errorlevel 1 (
    echo The install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)
call npm run dist
if errorlevel 1 (
  echo The build failed. If it mentions symbolic links, turn on Developer Mode
  echo in Windows Settings ^> For developers, or run this file as administrator.
  pause
  exit /b 1
)
echo.
echo Done. Your app is in the "dist" folder: FirstSniper.exe
pause
