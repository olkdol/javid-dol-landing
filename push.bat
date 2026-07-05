@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo  JaviD Landing Page - Commit and Push
echo  Remote: github.com/olkdol/javid-dol-landing
echo ============================================
echo.

git add .
git status --short
echo.

set MSG=%~1
if "%MSG%"=="" set MSG=Update landing page

git commit -m "%MSG%"
if errorlevel 1 (
  echo.
  echo [INFO] Nothing to commit or commit failed. Trying push anyway...
)

git push -u origin main
if errorlevel 1 (
  echo.
  echo [ERROR] Push failed. Check your GitHub login or network, then run this again.
) else (
  echo.
  echo [OK] Pushed. Cloudflare Pages will redeploy automatically in about a minute.
  echo      Check: https://javid-dol.uk
)
echo.
pause
