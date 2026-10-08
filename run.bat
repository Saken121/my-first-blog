@echo off
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    py -3.12 -m venv .venv
    if errorlevel 1 goto fail
)
".venv\Scripts\python.exe" -m pip --disable-pip-version-check --no-cache-dir install --require-hashes --only-binary=:all: -r requirements.lock
if errorlevel 1 goto fail
".venv\Scripts\python.exe" manage.py migrate --noinput
if errorlevel 1 goto fail
".venv\Scripts\python.exe" manage.py runserver 127.0.0.1:8000 --noreload
exit /b
:fail
echo Sprawdz instalacje Pythona 3.12 i polaczenie z internetem.
pause
exit /b 1
