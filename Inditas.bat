@echo off
title Uthirnok
cd /d "%~dp0"
if not exist "node_modules\electron" (
  echo Elso inditas: telepitem a fuggosegeket, ez par percig tart...
  call npm install
  if errorlevel 1 (
    echo.
    echo A telepites nem sikerult. Van fenn Node.js? https://nodejs.org
    pause
    exit /b 1
  )
)
call npm start
