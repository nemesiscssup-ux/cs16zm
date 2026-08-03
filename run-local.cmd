@echo off
REM Local test run of the Zombie Plague server on Windows binaries.
REM Deployment target is Linux; this is only for checking that the stack loads.
REM
REM Usage:  run-local.cmd [map]
REM Default map: de_dust2

setlocal
set ROOT=%~dp0
set NODE=%LOCALAPPDATA%\nodejs\node.exe
set MAP=%1
if "%MAP%"=="" set MAP=de_dust2

if not exist "%NODE%" (
  echo Node not found at %NODE%
  exit /b 2
)

if not exist "%ROOT%run\hlds.exe" (
  echo Run directory is not composed yet. Building it now...
  "%NODE%" "%ROOT%tools\compose-run.mjs"
  if errorlevel 1 exit /b 1
)

echo.
echo Starting server on map %MAP% ...
"%ROOT%run\hlds.exe" -console -game cstrike -port 27015 +maxplayers 12 +sv_lan 1 +map %MAP%

endlocal
