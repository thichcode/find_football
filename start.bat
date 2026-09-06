@echo off
rem Double-click la chay app: cai dependencies (lan dau), mo server, mo trinh duyet.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Chua co Node.js. Cai tu https://nodejs.org roi chay lai file nay.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Lan dau chay: dang cai dependencies, doi chut...
  call npm install
)

echo Dang khoi dong server, doi 3 gi...
start "FindFootball Server" /min cmd /c "npm start"
timeout /t 3 /nobreak >nul
start "" "http://localhost:3000"
echo Xong! Web da mo. Muon dung app thi tat cua so "FindFootball Server".
