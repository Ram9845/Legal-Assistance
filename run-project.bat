@echo off
cd /d "%~dp0"
start "Legal ML API" cmd /k "cd /d %~dp0ml-fastapi && python -m uvicorn main:app --host 0.0.0.0 --port 8000"
start "Legal Backend" cmd /k "cd /d %~dp0backend-node && node apiServer.js"
start "Legal Frontend" cmd /k "cd /d %~dp0frontend && node webServer.js"
echo Services started in 3 terminals.
echo Frontend: http://localhost:3000
