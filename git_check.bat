@echo off
cd /d "c:\Users\raman\Desktop\Legal_Assistace_project\legal-rag-fullstack"

echo ===== REMOTE =====
git remote -v 2>&1
echo.

echo ===== STATUS =====
git status 2>&1
echo.

echo ===== BRANCH =====
git branch 2>&1
echo.

echo ===== LOG (last 3) =====
git log --oneline -3 2>&1
