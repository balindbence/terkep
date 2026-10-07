@echo off
setlocal
title Uthirnok - telepito keszitese
cd /d "%~dp0"

echo ============================================
echo   Uthirnok - telepito keszitese
echo ============================================
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo [HIBA] Nem talalom az npm-et.
  echo.
  echo Telepitsd a Node.js LTS verziot: https://nodejs.org
  echo Telepites utan ZARD BE ezt az ablakot es inditsd ujra ezt a fajlt.
  echo.
  pause
  exit /b 1
)

echo Node.js verzio:
call node -v
echo.

echo [1/2] Fuggosegek telepitese/frissitese... (elso alkalommal par perc)
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo [HIBA] A fuggosegek telepitese nem sikerult. A fenti uzenetet kuldd el.
  pause
  exit /b 1
)
echo.

echo [2/2] Telepito epitese... (ez is eltarthat par percig)
call npm run dist
if errorlevel 1 (
  echo.
  echo [HIBA] A build nem sikerult. A fenti uzenetet kuldd el.
  pause
  exit /b 1
)

echo.
echo ============================================
echo   KESZ! A telepito a "dist" mappaban van.
echo ============================================
if exist "%~dp0dist" start "" "%~dp0dist"
echo.
pause
