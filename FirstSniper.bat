@echo off
setlocal
cd /d "%~dp0"
title FirstSniper
if not exist "package.json" (
  echo This file must be run from the unzipped folder, not from inside the zip.
  echo Right-click the zip, choose Extract All, then open the extracted folder.
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Download the LTS version from https://nodejs.org , install it, then run this file again.
  pause
  exit /b 1
)
if not exist "node_modules\ws\package.json" (
  echo Installing the app's parts. This takes a minute the first time only...
  call npm install --ignore-scripts
  if errorlevel 1 (
    echo.
    echo The install failed. Check your internet connection and try again.
    echo If it keeps failing, copy the text above and send it to me.
    pause
    exit /b 1
  )
)

set "ELECTRON_SKIP_BINARY_DOWNLOAD="
set "ELECTRON_OVERRIDE_DIST_PATH="
if exist "node_modules\electron\dist\electron.exe" goto start

echo Downloading the Electron program file, about 100 MB.
echo This can take a few minutes and shows no progress bar. Please wait...
if exist "node_modules\electron\dist" rmdir /s /q "node_modules\electron\dist"
if exist "node_modules\electron\path.txt" del /f /q "node_modules\electron\path.txt"

set "ARCH=x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH=arm64"
set "EVER="
for /f "delims=" %%v in ('node electron-version.js') do set "EVER=%%v"
if not defined EVER goto dlfail

set "URL=https://github.com/electron/electron/releases/download/v%EVER%/electron-v%EVER%-win32-%ARCH%.zip"
set "ZIP=%TEMP%\electron-v%EVER%-win32-%ARCH%.zip"
if exist "%ZIP%" del /f /q "%ZIP%"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; try { Invoke-WebRequest -UseBasicParsing -Uri '%URL%' -OutFile '%ZIP%' } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 goto dlfail
if not exist "%ZIP%" goto dlfail

echo Unpacking...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; try { Expand-Archive -LiteralPath '%ZIP%' -DestinationPath 'node_modules\electron\dist' -Force } catch { Write-Host $_.Exception.Message; exit 1 }"
if errorlevel 1 goto dlfail

<nul set /p "=electron.exe" >"node_modules\electron\path.txt"
del /f /q "%ZIP%" >nul 2>nul

if exist "node_modules\electron\dist\electron.exe" goto start

echo.
echo Electron still was not installed. Please copy everything between the lines and send it to me:
echo ----------------------------------------
node --version
npm --version
echo Download address: %URL%
echo Contents of node_modules\electron\dist:
dir "node_modules\electron\dist"
echo ----------------------------------------
echo Also check Windows Security ^> Protection history, in case it removed a file.
pause
exit /b 1

:dlfail
echo.
echo The download or unpacking failed. Check your internet connection and try again.
echo If it keeps failing, copy the text above and send it to me.
pause
exit /b 1

:start
echo Starting FirstSniper...
call npm start
if errorlevel 1 (
  echo.
  echo The app stopped with an error. Copy the text above and send it to me.
  pause
)
