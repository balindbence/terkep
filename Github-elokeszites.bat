@echo off
title Uthirnok - GitHub workflow elokeszitese
cd /d "%~dp0"
if not exist "github-workflow-build.yml" (
  echo Nem talalom a github-workflow-build.yml fajlt.
  pause & exit /b 1
)
if not exist ".github\workflows" mkdir ".github\workflows"
move /y "github-workflow-build.yml" ".github\workflows\build.yml" >nul
echo Kesz: .github\workflows\build.yml
echo Ezt kell felpusholni a GitHubra, hogy magatol epitse a telepitot.
pause
