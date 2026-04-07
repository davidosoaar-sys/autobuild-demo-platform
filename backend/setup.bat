@echo off
echo ============================================
echo  AutoBuild AI — Backend Setup (Windows)
echo ============================================

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Install Python 3.10+ from python.org
    pause
    exit /b 1
)

:: Create virtual environment
echo.
echo [1/4] Creating virtual environment...
python -m venv venv
call venv\Scripts\activate.bat

:: Upgrade pip
echo.
echo [2/4] Upgrading pip...
python -m pip install --upgrade pip

:: Install dependencies
echo.
echo [3/4] Installing dependencies...
pip install -r requirements.txt

:: Create folders
echo.
echo [4/4] Creating output folders...
mkdir results 2>nul
mkdir checkpoints 2>nul
mkdir tb_logs 2>nul

echo.
echo ============================================
echo  Setup complete!
echo.
echo  Next steps:
echo  1. Train the model (run once, ~20 min):
echo     venv\Scripts\activate.bat
echo     python train.py
echo.
echo  2. Start the API server:
echo     venv\Scripts\activate.bat
echo     python -m uvicorn main:app --reload --port 8000
echo.
echo  3. Your Next.js app talks to:
echo     http://localhost:8000
echo ============================================
pause