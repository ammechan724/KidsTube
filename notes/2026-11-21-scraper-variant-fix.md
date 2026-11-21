# 2026-11-21 — Scraper page-variant bug: a random channel was wiped to 0 videos every run

## Symptom

Every scrape run, exactly one channel came back with **0 videos** — and it was a
different channel each time (Peppa Pig on the CI run, Kala EE locally, Daniel Tiger
on the 2026-11-16 run). The published `data/videos.json` therefore dropped a whole
show from the kid's site for a week.

## Root cause

Not a network failure. YouTube serves **two different HTML shapes** for
`/channel/<id>/videos`:

**Variant A (legacy)** — inline JS assignment:
```html
<script>var ytInitialData = {...};</script>
```

**Variant B (current)** — the payload ships as a JSON script tag and YouTube's own
bootstrap assigns it to `window.ytInitialData`:
```html
<script id="yt-initial-data" type="application/json">{...}</script>
```

The scraper only knew variant A:
```js
const m = html.match(/var ytInitialData\s*=\s*(\{.*?\});\s*<\/script>/);
if (!m) throw new Error('ytInitialData not found');
```

Variant B therefore threw `ytInitialData not found` → the `catch` block did
`break` → the channel was written out with 0 videos.

Measured rate: **~1 request in 15** returns variant B (A/B test / edge routing —
it is not geo- or IP-based; the same URL returns either shape on different calls).
Both variants return HTTP 200 with a normal ~1.2 MB body and the correct
`<title>`, so there is no HTTP-level signal to distinguish them — only the markup.

## Fix (3 layers)

1. **Parse both variants** — `parseYtInitialData()` now falls back to the
   `<script id="yt-initial-data" type="application/json">` tag. This alone removes
   ~all failures.
2. **Retry with backoff** — `withRetry(fn, { attempts: 3, baseDelay: 1200 })`
   wraps both the initial HTML fetch and the `youtubei` continuation POST. A
   second request virtually always returns a usable page.
3. **Never regress to 0** — `loadPreviousCache()` reads the previous
   `data/videos.json`; if a channel yields 0 videos this run but the cache has
   videos for that `channelId`, the cached list (and avatar) are kept and the
   entry is flagged `cached: true`. A transient YouTube quirk can no longer
   remove a show from the live site.

## Verification

- 3 consecutive local runs after the fix: **649 videos, 23/23 channels, zero
  retries needed**.
- Fallback path tested in isolation with a deliberately invalid `channelId`
  (HTTP 404): `retry 1/2` → `retry 2/2` → fetch failed → `! Ghost Channel: 0
  videos this run — keeping 1 cached videos` → published with `cached: true`.

## Related

- `notes/2026-10-26-pat-rotation.md` — PAT rotation runbook.
- `notes/2026-10-26-watchdog.md` — weekly watchdog report.
