@echo off
setlocal enabledelayedexpansion
title Uthirnok - uj verzio kiadasa
cd /d "%~dp0"

echo ============================================
echo   Uthirnok - uj verzio kiadasa GitHubra
echo ============================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo [HIBA] Nincs fent a git.
  pause
  exit /b 1
)
if not exist ".git" (
  echo [HIBA] Ez a mappa meg nincs osszekotve GitHubbal.
  echo Futtasd eloszor a GitHub-feltoltes.bat fajlt.
  pause
  exit /b 1
)

rem A GitHub build-recept frissitese, ha jott uj
if exist "github-workflow-build.yml" (
  if not exist ".github\workflows" mkdir ".github\workflows"
  move /y "github-workflow-build.yml" ".github\workflows\build.yml" >nul
  echo Build-recept frissitve.
)

echo Verziószam emelese...
call npm version patch --no-git-tag-version >nul
if errorlevel 1 (
  echo [HIBA] Nem sikerult a verziot emelni.
  pause
  exit /b 1
)

node -p "require('./package.json').version" > "%TEMP%\ph-ver.txt"
set /p VER=<"%TEMP%\ph-ver.txt"
del "%TEMP%\ph-ver.txt" >nul 2>nul
if "!VER!"=="" (
  echo [HIBA] Nem tudtam kiolvasni a verziot.
  pause
  exit /b 1
)
echo Uj verzio: !VER!
echo.

rem az alairo kulcs nem kerulhet a nyilvanos repoba
git rm -r -q --cached android-key >nul 2>nul
git rm -r -q --cached titkos-kulcs >nul 2>nul
git add -A
git commit -m "v!VER!" >nul 2>nul
git push origin main
if errorlevel 1 goto :pushfail

git tag -f "v!VER!"
git push -f origin "v!VER!"
if errorlevel 1 goto :pushfail

echo.
echo ============================================
echo   Elindult a build a GitHubon.
echo ============================================
echo.
echo   Kb. 10 perc mulva a Releases oldalon lesz
echo   az Uthirnok-!VER!-telepito.exe (Windows)
echo   az Uthirnok-!VER!-hordozhato.exe (Windows)
echo   es az Uthirnok-!VER!-android.apk (telefon)
echo.
start "" "https://github.com/balindbence/uthirnok/actions"
pause
exit /b 0

:pushfail
echo.
echo [HIBA] A feltoltes nem sikerult. A fenti uzenetet kuldd el a chatben.
pause
exit /b 1
