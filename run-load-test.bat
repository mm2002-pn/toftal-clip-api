@echo off
REM Script pour exécuter les tests de charge JMeter
REM Usage: run-load-test.bat [light|moderate|heavy] [with-report]

setlocal enabledelayedexpansion

REM Configuration
set TEST_FILE=load-test-jmeter.jmx
set TIMESTAMP=%date:~6,4%%date:~3,2%%date:~0,2%_%time:~0,2%%time:~3,2%%time:~6,2%
set RESULTS_DIR=load-test-results
set RESULTS_FILE=%RESULTS_DIR%\results_%TIMESTAMP%.jtl
set LOG_FILE=%RESULTS_DIR%\jmeter_%TIMESTAMP%.log
set REPORT_DIR=%RESULTS_DIR%\report_%TIMESTAMP%

REM Créer le répertoire des résultats
if not exist %RESULTS_DIR% mkdir %RESULTS_DIR%

REM Paramètres par défaut
set TEST_SCENARIO=moderate
set GENERATE_REPORT=0

REM Analyser les arguments
if "%1"=="light" set TEST_SCENARIO=light
if "%1"=="moderate" set TEST_SCENARIO=moderate
if "%1"=="heavy" set TEST_SCENARIO=heavy
if "%1"=="help" goto help
if "%1"=="" goto default

if "%2"=="report" set GENERATE_REPORT=1
if "%2"=="with-report" set GENERATE_REPORT=1

:default
echo.
echo ============================================
echo   Toftal Clip - Test de Charge JMeter
echo ============================================
echo.
echo Configuration:
echo - Scénario: %TEST_SCENARIO%
echo - Fichier test: %TEST_FILE%
echo - Résultats: %RESULTS_FILE%
echo - Rapport: %GENERATE_REPORT%
echo.

REM Vérifier que le backend est accessible
echo Vérification de la connexion au backend...
curl -s http://localhost:4000/api/v1/auth/me > nul 2>&1
if %errorlevel% neq 0 (
    echo ERREUR: Le backend n'est pas accessible sur http://localhost:4000
    echo Veuillez démarrer le backend avant de lancer le test.
    echo.
    pause
    exit /b 1
)
echo ✓ Backend est accessible

REM Vérifier que JMeter est installé
jmeter --version > nul 2>&1
if %errorlevel% neq 0 (
    echo ERREUR: JMeter n'est pas installé ou n'est pas dans le PATH
    echo Veuillez installer JMeter: https://jmeter.apache.org/download_jmeter.cgi
    echo.
    pause
    exit /b 1
)
echo ✓ JMeter est installé
echo.

echo Lancement du test...
echo.

if %GENERATE_REPORT% equ 1 (
    REM Exécuter avec rapport HTML
    jmeter -n -t %TEST_FILE% -l %RESULTS_FILE% -j %LOG_FILE% -e -o %REPORT_DIR%
) else (
    REM Exécuter sans rapport HTML (plus rapide)
    jmeter -n -t %TEST_FILE% -l %RESULTS_FILE% -j %LOG_FILE%
)

echo.
echo ============================================
echo   Test Terminé
echo ============================================
echo.
echo Résultats:
echo - Fichier JTL: %RESULTS_FILE%
echo - Log: %LOG_FILE%
if %GENERATE_REPORT% equ 1 (
    echo - Rapport HTML: %REPORT_DIR%\index.html
    echo.
    echo Ouvrir le rapport dans le navigateur...
    start "" "%CD%\%REPORT_DIR%\index.html"
)
echo.

echo Résumé rapide:
echo ===============
jmeter -g %RESULTS_FILE% -o %REPORT_DIR% > nul 2>&1

REM Afficher un résumé simple
echo.
echo Pour analyser les résultats en détail:
echo - Ouvrir le rapport HTML: %REPORT_DIR%\index.html
echo - Ou utiliser JMeter GUI: jmeter -t %TEST_FILE%
echo.

pause
exit /b 0

:help
echo.
echo Usage: run-load-test.bat [scenario] [rapport]
echo.
echo Scénarios:
echo   light      - Test léger (10 utilisateurs)
echo   moderate   - Test modéré (50 utilisateurs, par défaut)
echo   heavy      - Test de stress (100+ utilisateurs)
echo.
echo Options:
echo   with-report   - Générer un rapport HTML (plus lent)
echo   help          - Afficher cet aide
echo.
echo Exemples:
echo   run-load-test.bat                    (test modéré, sans rapport)
echo   run-load-test.bat light with-report  (test léger avec rapport)
echo   run-load-test.bat heavy with-report  (test de stress avec rapport)
echo.
pause
exit /b 0
