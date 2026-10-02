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
    [/(\d+)\s*分钟前|(\d+)\s*分鐘前/, 'minute'],
    [/(\d+)\s*小时前|(\d+)\s*小時前/, 'hour'],
    [/(\d+)\s*天前|(\d+)\s*日前/, 'day'],
    [/(\d+)\s*周前|(\d+)\s*週前/, 'week'],
    [/(\d+)\s*个月前|(\d+)\s*個月前/, 'month'],
    [/(\d+)\s*年前/, 'year'],
  ];
  for (const [pat, unit] of zhPatterns) {
    const m = s.match(pat);
    if (m) {
      const n = parseInt(m[1], 10);
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

    // New schema: lockupViewModel with contentType === VIDEO
    if (node.lockupViewModel && node.lockupViewModel.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
      const v = node.lockupViewModel;
      const videoId = v.contentId;
      if (!videoId) continue;
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
  const m = html.match(/var ytInitialData\s*=\s*(\{.*?\});\s*<\/script>/);
  if (!m) throw new Error('ytInitialData not found');
  return JSON.parse(m[1]);
}

async function fetchChannelVideos(channel, maxVideos) {
  const { channelId } = channel;
  const url = `https://www.youtube.com/channel/${channelId}/videos`;

  const videos = [];
  const seen = new Set();
  let token = null;
  let pages = 0;

  while (videos.length < maxVideos && pages < 30) {
    let data;
    try {
      if (token) {
        data = await postYoutubei({ context: { client: CLIENT }, continuation: token });
      } else {
        const html = await fetchHTML(url);
        data = parseYtInitialData(html);
      }
    } catch (e) {
      console.error(`  ${channel.name}: fetch failed: ${e.message}`);
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

  return videos.filter(v => !v.publishedMs || v.publishedMs >= CUTOFF_MS);
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

async function main() {
  console.log(`Scraping ${CHANNELS.length} channels · max ${MAX_PER_CHANNEL}/ch · last ${DAYS_BACK} days · concurrency ${CONCURRENCY}`);
  const startedAt = Date.now();
  const perChannel = await pool(CHANNELS, CONCURRENCY, async (ch) => {
    const t0 = Date.now();
    const vids = await fetchChannelVideos(ch, MAX_PER_CHANNEL);
    console.log(`  ✓ ${ch.name}: ${vids.length} videos (${((Date.now()-t0)/1000).toFixed(1)}s)`);
    return { ...ch, videos: vids, fetchedAt: Date.now() };
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