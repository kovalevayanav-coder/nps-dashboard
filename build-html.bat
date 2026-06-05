@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Установите Node.js с https://nodejs.org/ ^(LTS^), затем снова запустите этот файл.
  pause
  exit /b 1
)
echo Установка зависимостей...
call npm install
if errorlevel 1 (
  echo Ошибка npm install
  pause
  exit /b 1
)
echo Сборка одного HTML...
call npm run build:html
if errorlevel 1 (
  echo Ошибка сборки
  pause
  exit /b 1
)
echo.
echo Готово. Откройте в браузере файл:
echo   %~dp0dist\index.html
echo Его можно скопировать на рабочий стол и переименовать ^(например NPS-Dashboard.html^).
explorer "%~dp0dist"
pause
