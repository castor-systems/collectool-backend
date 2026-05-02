#!/usr/bin/env bash
set -euo pipefail

api_url="${1:-${COLLECTOOL_API_URL:-}}"

if [[ -z "$api_url" ]]; then
  echo "Usage: npm run health -- <api-url>"
  echo "Or set COLLECTOOL_API_URL before running npm run health."
  exit 1
fi

curl -fsS "${api_url%/}/health"
echo
