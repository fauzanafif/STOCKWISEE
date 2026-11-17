@echo off
REM ============================================================
REM  STOCKWISE - jalankan sebagai SERVER di PC ini (jaringan kantor)
REM  Web: http://10.10.20.14:8001  (frontend hasil build di backend\public)
REM  Klik-ganda file ini. Untuk development pakai start-dev.bat.
REM ============================================================
setlocal enabledelayedexpansion
cd /d "%~dp0"

REM --- 1. MySQL (Laragon) -------------------------------------
netstat -ano | findstr ":3306 " >nul 2>&1
if %errorlevel%==0 (
  echo [MySQL]    sudah jalan di port 3306
) else (
  set "MYSQLD="
  for /d %%D in ("C:\laragon\bin\mysql\*") do (
    if exist "%%~fD\bin\mysqld.exe" set "MYSQLD=%%~fD\bin\mysqld.exe"
  )
  if defined MYSQLD (
    echo [MySQL]    starting...
    start "STOCKWISE MySQL" /min "!MYSQLD!" --defaults-file="!MYSQLD:\bin\mysqld.exe=\my.ini!"
    timeout /t 6 >nul
  ) else (
    echo [MySQL]    tidak ketemu di C:\laragon - buka Laragon lalu Start All secara manual
  )
)

REM --- 2. STOCKWISE :8001 (API + web) -------------------------
netstat -ano | findstr "LISTENING" | findstr ":8001 " >nul 2>&1
if %errorlevel%==0 (
  echo [STOCKWISE] port 8001 sudah dipakai - server mungkin sudah jalan
) else (
  echo [STOCKWISE] http://10.10.20.14:8001
  start "STOCKWISE Server" /min cmd /k "cd /d %~dp0backend && php artisan serve --host=0.0.0.0 --port=8001"
)

echo.
echo STOCKWISE berjalan di http://10.10.20.14:8001 (buka dari PC mana pun di jaringan kantor).
echo Tutup jendela "STOCKWISE Server" untuk berhenti.
timeout /t 5 >nul
