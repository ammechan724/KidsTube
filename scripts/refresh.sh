#!/usr/bin/env bash
# scripts/refresh.sh — manually refresh the video cache and push.
# Fallback when GitHub Actions cron doesn't run, or for any reason you need
# to force a refresh.
#
# Requirements:
#   - node 18+
#   - git remote `origin` pointing at the repo
#   - either:
#     a) git credential helper configured (git push works without prompt), OR
#     b) GITHUB_TOKEN / GH_TOKEN env var set (will be used as the push URL credential)

set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
echo "Working directory: $ROOT"

echo ""
echo "→ Step 1/3: Scraping videos"
node scraper/scrape.mjs --max=100

echo ""
echo "→ Step 2/3: Staging videos.json"
git add public/data/videos.json data/videos.json

if git diff --cached --quiet; then
  echo "→ No changes to commit — cache is already up to date."
  exit 0
fi

echo ""
echo "→ Step 3/3: Committing + pushing"
git -c user.name="scraper-bot" \
    -c user.email="scraper-bot@users.noreply.github.com" \
    commit -m "chore: refresh video cache ($(date -u +%FT%TZ))"

# Use GH_TOKEN if set, else fall back to git's stored credentials
TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
if [[ -n "$TOKEN" ]]; then
  git push "https://x-access-token:${TOKEN}@github.com/$(git config --get remote.origin.url | sed -E 's#.*github.com[:/]([^/]+)/([^/.]+).*#\1/\2#')" HEAD:main
else
  git push
fi

echo ""
echo "✓ Done. Wait ~30s for Pages deploy, then check the site."