#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python3 -m venv "${BASE_DIR}/.venv"
"${BASE_DIR}/.venv/bin/pip" install --upgrade pip
"${BASE_DIR}/.venv/bin/pip" install --upgrade \
  google-api-python-client \
  google-auth-httplib2 \
  google-auth-oauthlib

chmod +x "${BASE_DIR}/bin/gcal"
echo "installed"
