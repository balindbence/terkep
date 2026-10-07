@echo off
title Uthirnok - telepito keszitese
cd /d "%~dp0"

rem --- rendszergazdai jog ellenorzese (a symlink-kicsomagolashoz kell) ---
net session >nul 2>&1
if not errorlevel 1 goto :admin

echo ============================================
echo   Uthirnok - telepito keszitese
echo ============================================
echo.
echo A build-hez rendszergazdai jog kell, mert a csomagolo olyan
echo archivumot bont ki, amiben symlinkek vannak.
echo.
echo Ujraindul emelt jogokkal - fogadd el a Windows kerdeset.
echo.
powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" 2>nul
if errorlevel 1 (
  echo.
  echo Nem sikerult az emelt jogu inditas.
  echo Jobb katt ezen a fajlon -^> "Futtatas rendszergazdakent".
  echo.
  pause
)
exit /b

:admin
cd /d "%~dp0"
echo ============================================
echo   Uthirnok - telepito keszitese (admin)
echo ============================================
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo [HIBA] Nem talalom az npm-et.
  echo Telepitsd a Node.js LTS verziot: https://nodejs.org
  echo Telepites utan zard be ezt az ablakot es inditsd ujra ezt a fajlt.
  pause
  exit /b 1
)

echo Node.js verzio:
call node -v
echo.

echo [1/3] Felbemaradt csomagolo-gyorsitotar torlese...
if exist "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign" (
  rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign"
)
echo.

echo [2/3] Fuggosegek telepitese/frissitese...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo [HIBA] A fuggosegek telepitese nem sikerult. A fenti uzenetet kuldd el.
  pause
  exit /b 1
)
echo.

echo [3/3] Telepito epitese... (par perc, tolt le ezt-azt)
call npm run dist
if errorlevel 1 (
  echo.
  echo [HIBA] A build nem sikerult. A fenti uzenetet kuldd el.
  echo.
  echo Tipp: kapcsold be a Windows fejlesztoi modot is
  echo   Beallitasok - Rendszer - Fejlesztoknek - Fejlesztoi mod
  echo es probald ujra.
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
