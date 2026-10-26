#!/usr/bin/env bash
# set-pat.sh — install a new GitHub PAT for the KidsTube repo without exposing it in chat.
#
# Usage:
#   ./scripts/set-pat.sh <path-to-file-containing-pat>
#   ./scripts/set-pat.sh -            # read PAT from stdin (no echo)
#
# The PAT is written into .git/config remote URL (same as before) and verified
# against GET https://api.github.com/user. Nothing is printed except the auth result.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

PAT_FILE="${1:-}"
if [[ "$PAT_FILE" == "-" ]]; then
  PAT="$(cat)"
elif [[ -n "$PAT_FILE" && -f "$PAT_FILE" ]]; then
  PAT="$(tr -d ' \t\r\n' < "$PAT_FILE")"
else
  echo "usage: $0 <pat-file> | -" >&2
  exit 2
fi

if [[ -z "$PAT" ]]; then
  echo "FAIL: empty PAT" >&2
  exit 3
fi

# --- 1. verify the PAT against the GitHub API (never echo the header) ---
CODE="$(curl -s -o /tmp/kt_user.json -w '%{http_code}' -H "Authorization: Bearer $PAT" \
  -H 'Accept: application/vnd.github+json' https://api.github.com/user)"

if [[ "$CODE" != "200" ]]; then
  echo "FAIL: PAT rejected by GitHub (HTTP $CODE)" >&2
  exit 4
fi

LOGIN="$(sed -n 's/.*"login"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' /tmp/kt_user.json | head -n1)"
echo "OK: PAT accepted — authenticated as '$LOGIN'"

# --- 2. install it in the remote URL ---
git remote set-url origin "https://${PAT}@github.com/ammechan724/KidsTube.git"

# --- 3. sanity check the write path ---
if git ls-remote --exit-code origin >/dev/null 2>&1; then
  echo "OK: remote reachable with new PAT"
else
  echo "WARN: ls-remote failed after setting the remote" >&2
  exit 5
fi

echo "Done. PAT is installed in .git/config (local file, not in chat)."
