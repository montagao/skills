#!/usr/bin/env bash
# Fetch an SRT file from a URL and output its text content (dialogue only, no timestamps)
# Usage: fetch_srt.sh <srt_url>

set -euo pipefail

SRT_URL="${1:?Usage: fetch_srt.sh <srt_url>}"

curl -s "$SRT_URL" | sed '/^[0-9]*$/d; /^$/d; /-->/d'
