@echo off
setlocal enabledelayedexpansion
title Uthirnok - feltoltes GitHubra
cd /d "%~dp0"

echo ============================================
echo   Uthirnok - feltoltes GitHubra
echo ============================================
echo.

rem ---------- 1. git megvan? ----------
where git >nul 2>nul
if errorlevel 1 goto :nogit
echo Git verzio:
call git --version
echo.
goto :haveGit

:nogit
echo [HIBA] Nincs fent a git.
echo.
echo Most megnyitom a letoltooldalt: https://git-scm.com/download/win
echo Telepitesnel minden alapbeallitas jo, csak kattints vegig a Next gombokon.
echo Utana ZARD BE ezt az ablakot es inditsd ujra ezt a fajlt.
echo.
start "" "https://git-scm.com/download/win"
pause
exit /b 1

:haveGit

rem ---------- 2. build-recept a helyere ----------
if exist "github-workflow-build.yml" (
  if not exist ".github\workflows" mkdir ".github\workflows"
  move /y "github-workflow-build.yml" ".github\workflows\build.yml" >nul
)
if not exist ".github\workflows\build.yml" goto :noyml
echo Build-recept a helyen: .github\workflows\build.yml
echo.
goto :yamlOk

:noyml
echo [HIBA] Hianyzik a .github\workflows\build.yml fajl.
echo Szolj a chatben es potolom.
pause
exit /b 1

:yamlOk

rem ---------- 3. git azonosito ----------
set "GITNAME="
for /f "delims=" %%i in ('git config --global user.name 2^>nul') do set "GITNAME=%%i"
if "!GITNAME!"=="" (
  echo Meg nincs beallitva a neved a githez.
  set /p "GITNAME=A neved: "
  git config --global user.name "!GITNAME!"
)

set "GITMAIL="
for /f "delims=" %%i in ('git config --global user.email 2^>nul') do set "GITMAIL=%%i"
if "!GITMAIL!"=="" (
  echo Meg nincs beallitva az e-mail cimed a githez.
  set /p "GITMAIL=A GitHub e-mail cimed: "
  git config --global user.email "!GITMAIL!"
)
echo.

rem ---------- 4. repo URL ----------
echo --------------------------------------------
echo Ha meg nincs meg a repo, most hozd letre:
echo   1. Megnyitom a github.com/new oldalt
echo   2. Repository name:  uthirnok
echo   3. Public - igy barki letoltheti, es mukodik az app frissites-jelzese
echo   4. NE pipalj be semmit - se README, se .gitignore, se license
echo   5. Create repository
echo   6. A kovetkezo oldalon masold ki a .git-re vegzodo cimet
echo --------------------------------------------
echo.
set "OPENNEW="
set /p "OPENNEW=Megnyissam a github.com/new oldalt? i/n: "
if /i "!OPENNEW!"=="i" start "" "https://github.com/new"
echo.

set "REPOURL="
set /p "REPOURL=Repo URL, pl. https://github.com/nev/uthirnok.git : "
if "!REPOURL!"=="" goto :nourl
echo.

rem ---------- 5. feltoltes ----------
if not exist ".git" git init
git add -A
git commit -m "Uthirnok" >nul 2>nul
git branch -M main
git remote remove origin >nul 2>nul
git remote add origin "!REPOURL!"

echo Feltoltes... elsore bejelentkezest kerhet a bongeszoben.
git push -u origin main
if errorlevel 1 goto :pushfail
echo.
echo A kod fent van a GitHubon.
echo.

rem ---------- 6. kiadas ----------
set "MKTAG="
set /p "MKTAG=Elinditsam most a telepito epiteset a GitHubon? i/n: "
if /i not "!MKTAG!"=="i" goto :done

git tag -f v1.0.0
git push -f origin v1.0.0
if errorlevel 1 goto :tagfail
echo.
echo Elindult. Kb. 10 perc mulva a Releases oldalon lesz a Windows telepito es az Android APK.
set "RELURL=!REPOURL:.git=!"
start "" "!RELURL!/actions"
goto :done

:nourl
echo Nem adtal meg URL-t.
pause
exit /b 1

:pushfail
echo.
echo [HIBA] A feltoltes nem sikerult. A fenti uzenetet kuldd el a chatben.
pause
exit /b 1

:tagfail
echo.
echo [HIBA] A cimke feltoltese nem sikerult. A fenti uzenetet kuldd el.
pause
exit /b 1

:done
echo.
echo Kesz.
pause
