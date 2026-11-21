// scraper/scrape.mjs
// Pulls video metadata for each whitelisted channel by scraping /videos HTML pages.
// YouTube now uses lockupViewModel (post-2024 schema) for video tiles.
// No API key, no auth. Caches to data/videos.json.
//
// Usage: node scraper/scrape.mjs [--max=300] [--days=730] [--concurrency=4]

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const MAX_PER_CHANNEL = parseInt(args.max || '300', 10);
const DAYS_BACK = parseInt(args.days || '730', 10);
const CONCURRENCY = parseInt(args.concurrency || '4', 10);

const CHANNELS = JSON.parse(await fs.readFile(path.join(ROOT, 'channels.json'), 'utf8'));

const CUTOFF_MS = Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const CLIENT = { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'en', gl: 'US' };

// Map Chinese relative-time strings + English
function parseRelativeDate(text) {
  if (!text) return null;
  const s = String(text).toLowerCase()
    .replace(/^(streamed|premiered)\s+/i, '')
    // Chinese units
    .replace(/\s+/g, '');
  // Try Chinese patterns first
  const zhPatterns = [
    [/(\d+)\s*秒前/, 'second'],
    [/(\d+)\s*(?:分钟|分鐘)前/, 'minute'],
    [/(\d+)\s*(?:小时|小時)前/, 'hour'],
    [/(\d+)\s*(?:天|日)前/, 'day'],
    [/(\d+)\s*(?:周|週)前/, 'week'],
    [/(\d+)\s*(?:个月|個月)前/, 'month'],
    [/(\d+)\s*年前/, 'year'],
  ];
  for (const [pat, unit] of zhPatterns) {
    const m = s.match(pat);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!Number.isFinite(n)) continue;
      const ms = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_629_800_000, year: 31_557_600_000 }[unit];
      return Date.now() - n * ms;
    }
  }
  // English pattern
  const en = s.match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/);
  if (en) {
    const n = parseInt(en[1], 10);
    const ms = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000, month: 2_629_800_000, year: 31_557_600_000 }[en[2]];
    return Date.now() - n * ms;
  }
  return null;
}

// Extract the date string from metadataParts array
function extractDateText(metadataParts) {
  if (!Array.isArray(metadataParts)) return null;
  for (const part of metadataParts) {
    const txt = part?.text?.content;
    if (!txt) continue;
    // Skip pure number strings (view counts)
    if (/^[0-9.,]+[KMB]?$/i.test(txt)) continue;
    return txt;
  }
  return null;
}

// Walk JSON and extract all lockupViewModel video tiles
function extractVideos(data) {
  const out = [];
  const stack = [data];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;

    // New schema: lockupViewModel with contentType === VIDEO (filter out Shorts, live, playlist)
    if (node.lockupViewModel) {
      const ct = node.lockupViewModel.contentType;
      // Strict: only regular videos. Skip Shorts, Live, Playlists if they ever appear.
      if (ct !== 'LOCKUP_CONTENT_TYPE_VIDEO') continue;
      const v = node.lockupViewModel;
      const videoId = v.contentId;
      if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) continue;
      // Reject Shorts: YouTube uses 11-char IDs for both, but Shorts have contentType 'SHORTS'.
      // As defense-in-depth, also check title/url for shorts signature if we ever need to.
      const title = v.metadata?.lockupMetadataViewModel?.title?.content || '';
      const meta = v.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel;
      const dateText = meta ? extractDateText(meta.metadataRows?.[0]?.metadataParts) : null;
      const dateMs = parseRelativeDate(dateText);
      out.push({
        videoId,
        title,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        publishedText: dateText,
        publishedMs: dateMs,
      });
      continue;
    }

    // Old schema fallback
    if (node.videoRenderer?.videoId) {
      const v = node.videoRenderer;
      const dateText = v.publishedTimeText?.simpleText;
      out.push({
        videoId: v.videoId,
        title: v.title?.runs?.[0]?.text || v.title?.simpleText || '',
        thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
        publishedText: dateText,
        publishedMs: parseRelativeDate(dateText),
      });
      continue;
    }

    for (const k of Object.keys(node)) stack.push(node[k]);
  }
  return out;
}

function findContinuation(data) {
  const stack = [data];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n !== 'object') continue;
    if (n.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token) {
      return n.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
    }
    for (const k of Object.keys(n)) stack.push(n[k]);
  }
  return null;
}

async function fetchHTML(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-HK,zh;q=0.9,en;q=0.8' } });
  if (!res.ok) throw new Error(`HTML fetch ${res.status} ${url}`);
  return res.text();
}

async function postYoutubei(body) {
  const url = 'https://www.youtube.com/youtubei/v1/browse?prettyPrint=false';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': UA,
      'Accept-Language': 'zh-HK,zh;q=0.9,en;q=0.8',
      'X-Youtube-Client-Name': '1',
      'X-Youtube-Client-Version': '2.20240101.00.00',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`youtubei ${res.status}`);
  return res.json();
}

function parseYtInitialData(html) {
  // Variant A (legacy): `var ytInitialData = {...};` inside a <script> block.
  const m = html.match(/var ytInitialData\s*=\s*(\{.*?\});\s*<\/script>/);
  if (m) return JSON.parse(m[1]);

  // Variant B (current): the payload ships as a JSON <script type="application/json">
  // tag and YouTube's own bootstrap assigns it to window.ytInitialData.
  // YouTube serves this variant on roughly 1 request in 15 (A/B / edge routing),
  // so before this was handled the scraper silently produced 0 videos for a
  // random channel on every run. See notes/2026-11-21-scraper-variant-fix.md.
  const tag = html.match(/<script[^>]*\bid=["']yt-initial-data["'][^>]*>([\s\S]*?)<\/script>/);
  if (tag) {
    try {
      return JSON.parse(tag[1]);
    } catch (e) {
      throw new Error(`yt-initial-data JSON parse failed: ${e.message}`);
    }
  }

  throw new Error('ytInitialData not found');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Retry transient network / parse failures with linear backoff.
// YouTube occasionally answers 200 with an unexpected page shape; a second
// request almost always returns a usable one.
async function withRetry(fn, { attempts = 3, baseDelay = 1200, label = '' } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < attempts) {
        const d = baseDelay * i;
        console.warn(`  retry ${i}/${attempts - 1} in ${d}ms${label ? ` [${label}]` : ''}: ${e.message}`);
        await sleep(d);
      }
    }
  }
  throw lastErr;
}

// --- YouTube per-channel RSS feed (independent second source) ---
// The /videos HTML grid occasionally comes back with an empty grid for flagged
// IPs — GitHub's US runner IPs do this consistently for Daniel Tiger's
// Neighborhood, which then hides the whole channel from the site (the frontend
// drops channels with 0 videos). The RSS feed is a plain XML endpoint that is
// not layout-scraped, so it is a far more reliable second source.
//
// It only carries the latest ~15 uploads, so it is merged in as a supplement
// rather than a replacement.
function decodeXml(s) {
  if (!s) return '';
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// Render an exact timestamp the same way YouTube's own relative labels read,
// so a card fed by the RSS feed looks identical to one fed by the grid scrape.
function formatRelative(ms) {
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分鐘前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小時前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 個月前`;
  return `${Math.floor(days / 365)} 年前`;
}

function parseRssEntries(xml) {
  const out = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const en = m[1];
    const videoId = (en.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/) || [])[1];
    if (!videoId) continue;
    const title = decodeXml((en.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
    const published = (en.match(/<published>([\s\S]*?)<\/published>/) || [])[1];
    const publishedMs = published ? Date.parse(published) : NaN;
    const thumb = (en.match(/<media:thumbnail url="([^"]+)"/) || [])[1]
      || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    out.push({
      videoId,
      title,
      thumbnail: thumb.replace(/=s\d+(-c-k-c0x00ffffff-no-rj)?$/, ''),
      publishedText: Number.isFinite(publishedMs) ? formatRelative(publishedMs) : null,
      publishedMs: Number.isFinite(publishedMs) ? publishedMs : null,
      source: 'rss',
    });
  }
  return out;
}

async function fetchChannelRSS(channelId) {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const xml = await fetchHTML(url);
  if (!xml.includes('<entry>')) throw new Error('RSS feed had no entries');
  return parseRssEntries(xml);
}

// Extract channel avatar URL from og:image meta tag.
// YouTube renders <meta property="og:image" content="https://yt3.googleusercontent.com/...?s900-c-k...">
// Strip size param so we can request any size at display time.
function extractAvatar(html) {
  const m = html.match(/<meta\s+property="og:image"\s+content="(https:\/\/yt3\.googleusercontent\.com\/[^"]+)"/);
  if (!m) return null;
  // Strip =sNNN-c... size suffix; we'll add our own at render time.
  return m[1].replace(/=s\d+(-c-k-c0x00ffffff-no-rj)?$/, '');
}

async function fetchChannelVideos(channel, maxVideos) {
  const { channelId } = channel;
  const url = `https://www.youtube.com/channel/${channelId}/videos`;

  let avatar = null;
  const videos = [];
  const seen = new Set();
  let token = null;
  let pages = 0;

  while (videos.length < maxVideos && pages < 30) {
    let data;
    try {
      if (token) {
        data = await withRetry(
          () => postYoutubei({ context: { client: CLIENT }, continuation: token }),
          { attempts: 3, label: `${channel.name} p${pages + 1}` },
        );
      } else {
        const got = await withRetry(async () => {
          const html = await fetchHTML(url);
          return { html, data: parseYtInitialData(html) };
        }, { attempts: 3, label: channel.name });
        avatar = extractAvatar(got.html);
        data = got.data;
      }
    } catch (e) {
      console.error(`  ${channel.name}: fetch failed after ${3} attempts: ${e.message}`);
      break;
    }

    const batch = extractVideos(data);
    let oldestBatchMs = Infinity;
    for (const v of batch) {
      if (seen.has(v.videoId)) continue;
      seen.add(v.videoId);
      videos.push(v);
      if (v.publishedMs && v.publishedMs < oldestBatchMs) oldestBatchMs = v.publishedMs;
    }
    pages += 1;

    if (oldestBatchMs !== Infinity && oldestBatchMs < CUTOFF_MS) break;

    token = findContinuation(data);
    if (!token) break;
    await new Promise(r => setTimeout(r, 300));
  }

  // Merge in the RSS feed as an independent second source. This guarantees the
  // newest uploads are present even when the HTML grid came back empty.
  try {
    const rss = await withRetry(() => fetchChannelRSS(channelId), {
      attempts: 2, baseDelay: 1000, label: `${channel.name} rss`,
    });
    let added = 0;
    for (const v of rss) {
      if (seen.has(v.videoId)) continue;
      seen.add(v.videoId);
      videos.push(v);
      added++;
    }
    if (added) console.log(`    ↳ +${added} from RSS`);
  } catch (e) {
    console.warn(`  ${channel.name}: RSS fetch failed: ${e.message}`);
  }

  return { videos: videos.filter(v => !v.publishedMs || v.publishedMs >= CUTOFF_MS), avatar };
}

async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { results[idx] = await fn(items[idx], idx); }
      catch (e) { results[idx] = { error: e.message }; }
    }
  });
  await Promise.all(workers);
  return results;
}

// Previous run's cache, keyed by channelId. Used as a safety net so a transient
// YouTube failure can never publish a channel with 0 videos (which would
// silently drop a whole show from the kid's site for a week).
async function loadPreviousCache() {
  const p = path.join(ROOT, 'data', 'videos.json');
  try {
    const raw = JSON.parse(await fs.readFile(p, 'utf8'));
    const map = new Map();
    for (const c of raw.channels || []) {
      if (c && c.channelId) map.set(c.channelId, c);
    }
    console.log(`Previous cache loaded: ${map.size} channels`);
    return map;
  } catch (e) {
    console.log(`No previous cache (${e.code || e.message}) — cold start`);
    return new Map();
  }
}

async function main() {
  console.log(`Scraping ${CHANNELS.length} channels · max ${MAX_PER_CHANNEL}/ch · last ${DAYS_BACK} days · concurrency ${CONCURRENCY}`);
  const startedAt = Date.now();
  const previous = await loadPreviousCache();

  const perChannel = await pool(CHANNELS, CONCURRENCY, async (ch) => {
    const t0 = Date.now();
    const { videos: vids, avatar } = await fetchChannelVideos(ch, MAX_PER_CHANNEL);
    let finalVideos = vids;
    let finalAvatar = avatar;
    let cached = false;

    if (vids.length === 0) {
      const prev = previous.get(ch.channelId);
      if (prev && (prev.videos || []).length > 0) {
        finalVideos = prev.videos;
        finalAvatar = avatar || prev.avatar || null;
        cached = true;
        const when = prev.fetchedAt ? new Date(prev.fetchedAt).toISOString().slice(0, 10) : 'unknown date';
        console.warn(`  ! ${ch.name}: 0 videos this run — keeping ${prev.videos.length} cached videos (from ${when})`);
      }
    }

    console.log(`  ✓ ${ch.name}: ${finalVideos.length} videos${finalAvatar ? ' +avatar' : ''}${cached ? ' (cached)' : ''} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    return { ...ch, videos: finalVideos, avatar: finalAvatar, fetchedAt: Date.now(), cached };
  });

  const output = {
    generatedAt: new Date().toISOString(),
    daysBack: DAYS_BACK,
    maxPerChannel: MAX_PER_CHANNEL,
    channels: perChannel,
  };
  await fs.mkdir(path.join(ROOT, 'data'), { recursive: true });
  await fs.mkdir(path.join(ROOT, 'public', 'data'), { recursive: true });
  const dataPath = path.join(ROOT, 'data', 'videos.json');
  const publicPath = path.join(ROOT, 'public', 'data', 'videos.json');
  await fs.writeFile(dataPath, JSON.stringify(output, null, 2));
  await fs.writeFile(publicPath, JSON.stringify(output, null, 2));

  const totalVideos = perChannel.reduce((s, c) => s + (c.videos?.length || 0), 0);
  console.log(`\nDone in ${((Date.now()-startedAt)/1000).toFixed(1)}s · ${totalVideos} total videos → ${dataPath} + ${publicPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });