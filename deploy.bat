@echo off
REM ============================================================
REM  STOCKWISE - build frontend lalu pasang ke server (backend\public)
REM  Klik-ganda file ini setelah ada perubahan di frontend.
REM  Server yang sedang jalan langsung memakai versi baru (cukup refresh browser).
REM ============================================================
cd /d "%~dp0frontend"
call npm run build
if errorlevel 1 (
  echo.
  echo [GAGAL] Build error - server tidak diubah.
  pause
  exit /b 1
)
xcopy /E /Y /I /Q "dist\assets" "..\backend\public\assets" >nul
copy /Y "dist\index.html" "..\backend\public\app.html" >nul
for %%F in (favicon.svg icons.svg logo.png) do if exist "dist\%%F" copy /Y "dist\%%F" "..\backend\public\%%F" >nul
echo.
echo [OK] STOCKWISE sudah diperbarui. Refresh browser (Ctrl+F5).
timeout /t 5 >nul
