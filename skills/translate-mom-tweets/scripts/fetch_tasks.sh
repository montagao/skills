#!/usr/bin/env bash
# Fetch top tasks from translate.mom API for a given date
# Usage: fetch_tasks.sh [YYYY-MM-DD]
# Defaults to today's date if not provided.

set -euo pipefail

DATE="${1:-$(date +%Y-%m-%d)}"
BASE_URL="${TRANSLATE_MOM_API:-http://plausible.translate.mom:8001}"
API_URL="${BASE_URL}/top-tasks?date=${DATE}"

curl -s "$API_URL"
