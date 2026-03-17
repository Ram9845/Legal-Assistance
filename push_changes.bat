@echo off
cd /d "c:\Users\raman\Desktop\Legal_Assistace_project\legal-rag-fullstack"

echo === Current remote config ===
git remote -v

echo.
echo === Git status ===
git status --short

echo.
echo === Setting remote URL ===
git remote set-url origin https://github.com/Ram9845/Legal-Assistance.git
if %errorlevel% neq 0 (
  git remote add origin https://github.com/Ram9845/Legal-Assistance.git
)

echo.
echo === Adding all changed files ===
git add frontend/public/js/app.js
git add frontend/public/css/style.css
git add frontend/public/css/home.css
git add frontend/public/css/auth.css
git add frontend/views/chat.ejs
git add frontend/views/home.ejs
git add frontend/views/login.ejs
git add frontend/views/register.ejs

echo.
echo === Commit message ===
git commit -m "feat: Improve UI and fix chat system

- Fix double-wrapped prompt (removes extra prefix in app.js)
- Add markdown rendering for AI responses (marked.js)
- Add copy-to-clipboard button on assistant messages
- Add user/bot avatars in chat bubbles
- Fix scroll-to-bottom after new message
- Add loading spinner on send button
- Redesign chat composer (inline upload icon, keyboard hints)
- Premium CSS redesign: glassmorphism, gradient bubbles, dark mode
- Improve home page: gradient headline, feature icons, glass navbar
- Improve auth pages: animated card border, shimmer button, status colors"

echo.
echo === Pushing to GitHub ===
git push origin HEAD

echo.
echo === Done ===
