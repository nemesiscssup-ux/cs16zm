@echo off
REM Privileges panel: a local web page for granting VIP / Leader / Imperator /
REM Creator to players. Writes the same custom/admins.ini as add-admin.mjs.
REM
REM The panel listens on 127.0.0.1 only and asks for a one-time key printed
REM in this window, so nothing is reachable from the network.
REM
REM Usage:  admin.cmd            (opens the browser)
REM         admin.cmd --port 9000

setlocal
set NODE=%LOCALAPPDATA%\nodejs\node.exe

if not exist "%NODE%" (
  echo Node not found at %NODE%
  exit /b 2
)

"%NODE%" "%~dp0tools\admin-web.mjs" --open %*
