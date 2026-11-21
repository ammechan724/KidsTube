#!/usr/bin/env bash
# save-pat.sh — interactive, history-safe PAT capture for the KidsTube repo.
#
# Usage:
#   ./scripts/save-pat.sh
#
# Prompts with a hidden input (no echo, no shell history), writes the token to
# `.pat` (mode 600, already gitignored), then hands it to set-pat.sh which
# verifies it against GitHub and installs it into .git/config.
#
# The token is NEVER printed to the terminal, the chat, or any log.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

PAT_FILE="$REPO_DIR/.pat"

if [[ ! -t 0 ]]; then
  echo "FAIL: needs an interactive terminal (stdin is not a TTY)." >&2
  echo "Use the file route instead: printf '%s' 'ghp_xxx' > .pat && ./scripts/set-pat.sh .pat" >&2
  exit 2
fi

echo "Paste your GitHub PAT (starts with ghp_ or github_pat_)."
echo "It will NOT be echoed and NOT stored in shell history."
echo

read -rs -p "PAT> " PAT
echo
echo

if [[ -z "$PAT" ]]; then
  echo "FAIL: empty input" >&2
  exit 3
fi

umask 077
printf '%s' "$PAT" > "$PAT_FILE"
unset PAT
chmod 600 "$PAT_FILE"
echo "Saved to .pat (mode 600, gitignored). Installing + verifying..."
echo

"$REPO_DIR/scripts/set-pat.sh" "$PAT_FILE"
