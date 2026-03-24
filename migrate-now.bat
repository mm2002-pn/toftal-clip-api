@echo off
echo ============================================
echo  DATABASE MIGRATION: Old Roles to New System
echo ============================================
echo.

REM Check if psql is available
where psql >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: psql not found in PATH
    echo.
    echo Please install PostgreSQL or add it to your PATH
    echo Alternative: Run the SQL commands manually in pgAdmin or Prisma Studio
    echo See MIGRATION-INSTRUCTIONS.md for details
    pause
    exit /b 1
)

echo Connecting to database...
echo.

psql postgresql://postgres:root@localhost:5432/toftal_studio_db -c "UPDATE \"User\" SET role = 'USER', \"talentModeEnabled\" = false WHERE role = 'CLIENT'; UPDATE \"User\" SET role = 'USER', \"talentModeEnabled\" = true, \"talentActivationDate\" = COALESCE(\"talentActivationDate\", CURRENT_TIMESTAMP) WHERE role = 'TALENT'; SELECT role, \"talentModeEnabled\", COUNT(*) as count FROM \"User\" GROUP BY role, \"talentModeEnabled\";"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ============================================
    echo  MIGRATION COMPLETED SUCCESSFULLY!
    echo ============================================
    echo.
    echo Now run: npx prisma generate
    echo Then restart your dev server
) else (
    echo.
    echo ============================================
    echo  MIGRATION FAILED
    echo ============================================
    echo.
    echo Please check MIGRATION-INSTRUCTIONS.md for manual steps
)

pause
