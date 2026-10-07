@echo off
title Uthirnok - alkalmazas keszitese
cd /d "%~dp0"

echo ============================================
echo   Uthirnok - alkalmazas keszitese
echo   (telepito nelkul, admin jog nelkul)
echo ============================================
echo.

where npm >nul 2>nul
if errorlevel 1 goto :nonode
echo Node.js verzio:
call node -v
echo.
goto :haveNode

:nonode
echo [HIBA] Nem talalom az npm-et.
echo Telepitsd a Node.js LTS verziot: https://nodejs.org
echo Utana zard be ezt az ablakot es inditsd ujra ezt a fajlt.
pause
exit /b 1

:haveNode

echo [1/5] Futo peldanyok leallitasa...
taskkill /F /IM "Uthirnok.exe" >nul 2>nul
taskkill /F /IM "electron.exe" >nul 2>nul
ping -n 3 127.0.0.1 >nul
echo.

echo [2/5] Regi build torlese...
if exist "%~dp0dist" rmdir /s /q "%~dp0dist" >nul 2>nul
if exist "%~dp0dist" (
  echo   A dist mappa zarolva volt - atnevezem.
  ren "%~dp0dist" "dist-regi-%RANDOM%" >nul 2>nul
)
if exist "%~dp0dist" goto :lockfail
echo.

echo [3/5] Fuggosegek telepitese/frissitese...
call npm install --no-audit --no-fund
if errorlevel 1 goto :npmfail
echo.

echo [4/5] Alkalmazas osszecsomagolasa... (par perc)
call npx electron-builder --win dir
echo.

set "APPDIR=%~dp0dist\win-unpacked"
if not exist "%APPDIR%\Uthirnok.exe" goto :packfail

echo [5/5] Asztali parancsikon es zip keszitese...
powershell -NoProfile -Command "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Uthirnok.lnk')); $s.TargetPath='%APPDIR%\Uthirnok.exe'; $s.WorkingDirectory='%APPDIR%'; $s.Save()"
echo   - Asztali parancsikon kesz.

echo   - Zip keszitese a laptopra... ez eltarthat egy percig.
powershell -NoProfile -Command "Compress-Archive -Path '%APPDIR%\*' -DestinationPath '%~dp0dist\Uthirnok-hordozhato.zip' -Force"
if exist "%~dp0dist\Uthirnok-hordozhato.zip" echo   - Zip kesz.
echo.

echo ============================================
echo   KESZ!
echo ============================================
echo.
echo   Inditas: az asztalon a "Uthirnok" ikon
echo   vagy:    dist\win-unpacked\Uthirnok.exe
echo.
echo   Masik gepre: dist\Uthirnok-hordozhato.zip
echo   Ott kicsomagolod es inditod az Uthirnok.exe-t.
echo   Nem kell ra se Node.js, se telepites.
echo.
echo   FONTOS: mielott ujra epitesz, zard be az appot!
echo.
start "" "%~dp0dist"
pause
exit /b 0

:lockfail
echo.
echo [HIBA] A "dist" mappat nem tudom torolni - valami meg fogja.
echo.
echo   1. Zard be az Uthirnok appot, ha nyitva van.
echo   2. Zard be a Fajlkezeloben a dist mappat.
echo   3. Ha ez sem segit, inditsd ujra a gepet, es futtasd ujra ezt a fajlt.
echo.
pause
exit /b 1

:npmfail
echo.
echo [HIBA] A fuggosegek telepitese nem sikerult. A fenti uzenetet kuldd el.
pause
exit /b 1

:packfail
echo.
echo [HIBA] Nem jott letre a "Uthirnok.exe".
echo A fenti uzenetet kuldd el a chatben.
pause
exit /b 1
