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
) else (
  REM Pick up the latest build every time. Only our part is copied, so this
  REM takes seconds -- the server never starts with stale plugins or models.
  REM A failed update must not block the server: it just runs on what it has.
  "%NODE%" "%ROOT%tools\compose-run.mjs" --update
)

echo.
echo Starting server on map %MAP% ...

REM The working directory MUST be the run directory itself. Otherwise
REM filesystem_stdio.dll cannot mount the game filesystem and dies on the
REM assertion "!m_bMounted" (FileSystem_Stdio.cpp:84) -- a modal Visual C++
REM dialog on a desktop, a silent 0x80000003 exit without one. The honest
REM error hiding behind it is "W_LoadWadFile: couldn't load gfx.wad".
REM Full path as well: with NoDefaultCurrentDirectoryInExePath set, cmd does not
REM look for programs in the current directory, so a bare "hlds.exe" is not found.
cd /d "%ROOT%run"
"%ROOT%run\hlds.exe" -console -game cstrike -port 27015 +maxplayers 12 +sv_lan 1 +map %MAP%

endlocal
