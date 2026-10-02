# KidsTube 🎬

A curated, kid-safe YouTube front-end for Amme's kid. Pulls the last 1-2 years of videos from a whitelist of 20 kids' channels and shows 20 random picks per channel in a YouTube-style dark UI. No login. No backend. No recommendation loop.

## How it works

```
YouTube /videos pages  ──┐
  (one per channel)       │  every 12h
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

Bebefinn · CBeebies · Sarah and Duck · Bounce Patrol · The Wiggles · Twirlywoos · Peppa Pig · Daniel Tiger's Neighborhood · Ms Rachel · Super Simple Songs · Yakka Dee! · Baby Shark · Hogi · Teletubbies · ABCmouse (Age of Learning) · Bluey · Pocoyo English · Hey Duggee · Mr Tumble · Sesame Street

## Run locally

```sh
node scraper/scrape.mjs     # refresh cache (writes to data/ AND public/data/)
python3 -m http.server -d public  # serve on http://localhost:8000
```

## Deploy to GitHub Pages

1. Push this repo to GitHub.
2. Settings → Pages → Source: **GitHub Actions**
3. Workflow `.github/workflows/pages.yml` auto-deploys `public/` to Pages on every push to `main`.
4. Workflow `.github/workflows/scrape.yml` runs every 12h, refreshes `public/data/videos.json`, commits back, and Pages redeploys.

The hosted URL will be `https://<owner>.github.io/<repo>/`.

## Cost

$0 — GitHub Pages + GitHub Actions free tier cover this. Scraper uses ~5 min/day of compute (~150 min/month), well under the 2,000 min/month free quota.

## Adding / removing channels

Edit `channels.json` and re-run the scraper (or wait for the next 12h cron). No frontend changes needed.

## Trademark

App name "KidsTube" uses a generic red play-button logo (not YouTube's wordmark). The YouTube player inside the embed iframe shows YouTube's own branding — that's YouTube's UI, not ours.
