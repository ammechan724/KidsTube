# scripts/refresh.ps1 — PowerShell version of refresh.sh for Windows.
# Same purpose: manually refresh video cache and push to GitHub.

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
$Root = (Get-Location).Path
Write-Host "Working directory: $Root"

Write-Host ""
Write-Host "-> Step 1/3: Scraping videos"
node scraper/scrape.mjs --max=100

Write-Host ""
Write-Host "-> Step 2/3: Staging videos.json"
git add public/data/videos.json data/videos.json

$diff = git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
  Write-Host "-> No changes to commit -- cache is already up to date."
  exit 0
}

Write-Host ""
Write-Host "-> Step 3/3: Committing + pushing"
git -c user.name="scraper-bot" -c user.email="scraper-bot@users.noreply.github.com" `
    commit -m "chore: refresh video cache ($((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')))"

$Token = $env:GH_TOKEN
if (-not $Token) { $Token = $env:GITHUB_TOKEN }

if ($Token) {
  $remote = git config --get remote.origin.url
  # Extract owner/repo from URL
  $pattern = 'github\.com[:/](.+?)/(.+?)(?:\.git)?$'
  if ($remote -match $pattern) {
    $ownerRepo = "$($Matches[1])/$($Matches[2])"
    git push "https://x-access-token:$Token@github.com/$ownerRepo" HEAD:main
  } else {
    Write-Host "Could not parse remote URL: $remote" -ForegroundColor Red
    exit 1
  }
} else {
  git push
}

Write-Host ""
Write-Host "Done. Wait ~30s for Pages deploy, then check the site."