@echo off
cd /d "%~dp0"
echo Starting FastAPI Backend on port 8001...
echo.
echo Make sure you have set GROQ_API_KEY environment variable!
echo If not set, run: set GROQ_API_KEY=your_key_here
echo.
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8001
