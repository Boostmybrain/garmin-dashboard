@echo off
chcp 65001 >nul
title Generation des tokens Garmin Connect
cd /d "%~dp0.."

echo ============================================
echo   Generation des tokens Garmin Connect
echo ============================================
echo.

REM Trouver un Python utilisable
set "PY="
where py >nul 2>&1 && set "PY=py"
if not defined PY (
    where python >nul 2>&1 && set "PY=python"
)
if not defined PY (
    echo [ERREUR] Python est introuvable sur ce PC.
    echo Installe-le depuis https://www.python.org/downloads/
    echo puis relance ce fichier.
    echo.
    pause
    exit /b 1
)

REM Installer garminconnect s'il manque
%PY% -c "import garminconnect" >nul 2>&1
if errorlevel 1 (
    echo Installation du module garminconnect ...
    %PY% -m pip install --quiet --user garminconnect
    if errorlevel 1 (
        echo.
        echo [ERREUR] L'installation a echoue.
        echo Lance manuellement :  %PY% -m pip install garminconnect
        echo.
        pause
        exit /b 1
    )
    echo Module installe.
    echo.
)

%PY% "%~dp0garmin_login.py"

echo.
echo ============================================
echo Termine. Tu peux fermer cette fenetre.
echo ============================================
pause
