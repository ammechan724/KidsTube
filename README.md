# KidsTube 🎬

A curated, kid-safe YouTube front-end for Amme's kid. Pulls the last 1-2 years of videos from a whitelist of 20 kids' channels and shows 20 random picks per channel in a YouTube-style dark UI. No login. No backend. No recommendation loop.

## How it works

```
YouTube /videos pages  ──┐
  (one per channel)       │  weekly Monday 6pm HKT
                         ▼
              GitHub Actions cron
              (scraper/scrape.mjs)
                         │
                         ▼
              public/data/videos.json
                         │
                         ▼
              Static frontend (public/)
                         │
                         ▼
                 Cloudflare CDN
                (kid taps → YouTube embed iframe)
```

The frontend never talks to YouTube directly — it loads the JSON cache and renders. The scraper is the only thing that talks to YouTube. Videos play inside the official YouTube embed player (in-app iframe), so the kid never leaves the site.

## Channels (20)

Bebefinn · CBeebies · Sarah and Duck · Bounce Patrol · The Wiggles · Twirlywoos · Peppa Pig · Daniel Tiger's Neighborhood · Ms Rachel · Super Simple Songs · Yakka Dee! · Baby Shark · Hogi · Teletubbies · ABCmouse · Bluey · Pocoyo English · Hey Duggee · Mr Tumble · Sesame Street

(Whitelist locked 2026-10-02. Resolution rule: highest-sub channel per brand; verify by sampling video titles.)

## Run locally

```sh
# Option 1: Makefile (Mac/Linux)
make scrape    # refresh cache
make serve     # serve public/ on http://localhost:8000

# Option 2: Raw commands
node scraper/scrape.mjs --max=100
python3 -m http.server -d public 8000
```

Open http://localhost:8000 to preview.

## Deploy to GitHub Pages

Already deployed at **https://ammechan724.github.io/KidsTube/**.

Workflows:
- `.github/workflows/pages.yml` — auto-deploys `public/` on every push to `main`
- `.github/workflows/scrape.yml` — runs weekly + on manual trigger, refreshes `public/data/videos.json`, commits back, and Pages redeploys

### Trigger scrape manually (3 options, easiest first)

1. **GitHub UI** (no setup needed):
   - Open https://github.com/ammechan724/KidsTube/actions/workflows/scrape.yml
   - Click **Run workflow** → Branch: `main` → Run
   - Wait ~30s, the new cache is live

2. **Makefile** (Mac/Linux, needs git auth):
   ```sh
   make refresh    # scrape + commit + push
   ```

3. **Manual script** (Mac/Linux/Windows):
   ```sh
   # Mac/Linux
   GH_TOKEN=ghp_xxx ./scripts/refresh.sh

   # Windows PowerShell
   $env:GH_TOKEN="ghp_xxx"; .\scripts\refresh.ps1
   ```

### Cron schedule

`scrape.yml` runs **every Monday at 6pm HKT (= Monday 10:00 UTC)**. Configured via cron expression `'0 10 * * 1'` in UTC (GitHub Actions cron is always UTC).

To change the schedule, edit `.github/workflows/scrape.yml` and commit.

### If cron stops firing

1. Check https://github.com/ammechan724/KidsTube/actions — are scrape.yml runs showing up?
2. If not, GitHub may have paused scheduled workflows due to inactivity. Click "Run workflow" once to re-enable.
3. If still broken, trigger manually via any of the 3 options above.

## Cost

$0 — GitHub Pages + GitHub Actions free tier cover this. Scraper uses ~5 min/week of compute (~25 min/month), well under the 2,000 min/month free quota.

## Adding / removing channels

Edit `channels.json` and re-run the scraper (locally or via GitHub UI). No frontend changes needed. Channel resolution rule: see MEMORY.md in the parent workspace.

## Trademark

App name "KidsTube" uses a generic red play-button logo (not YouTube's wordmark). The YouTube player inside the embed iframe shows YouTube's own branding — that's YouTube's UI, not ours.
