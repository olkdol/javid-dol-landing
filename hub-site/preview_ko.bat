@echo off
REM Local Korean preview of the landing site (Korean is not on the public site).
REM ASCII only: the project path contains Hangul.
cd /d "%~dp0"
node tools\preview_ko.mjs 8790
pause
