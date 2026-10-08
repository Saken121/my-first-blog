#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
if [ -z "${FORMA_PYTHON:-}" ]; then
    if [ ! -x .venv/bin/python ]; then
        python3 -m venv .venv
    fi
    FORMA_PYTHON="$PWD/.venv/bin/python"
fi
"$FORMA_PYTHON" -c 'import sys; assert sys.version_info >= (3, 12), "Wymagany Python 3.12 lub nowszy"'
"$FORMA_PYTHON" -m pip --disable-pip-version-check --no-cache-dir install --require-hashes --only-binary=:all: -r requirements.lock
"$FORMA_PYTHON" manage.py migrate --noinput
exec "$FORMA_PYTHON" manage.py runserver 127.0.0.1:8000 --noreload
