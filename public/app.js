// app.js — Kids YouTube client
const state = {
  data: null,
  activeChannel: null,    // null = all
  picksPerChannel: 20,
  videoOrder: new Map(),  // channelId -> array of video indices
};

const $ = (sel) => document.querySelector(sel);

async function loadData() {
  const res = await fetch('./data/videos.json');
  if (!res.ok) throw new Error('Failed to load videos.json');
  state.data = await res.json();
  state.data.channels = state.data.channels.filter(c => c.videos && c.videos.length > 0);
  seedShuffles();
}

function seedShuffles() {
  for (const ch of state.data.channels) {
    state.videoOrder.set(
      ch.channelId,
      shuffledIndices(ch.videos.length).slice(0, state.picksPerChannel)
    );
  }
}

function shuffledIndices(n) {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function reshuffle() {
  seedShuffles();
  render();
  // visual ping
  const btn = $('#shuffleBtn');
  btn.style.transform = 'rotate(360deg)';
  setTimeout(() => { btn.style.transform = ''; }, 350);
}

function render() {
  renderNav();
  renderContent();
  renderFooter();
}

function renderNav() {
  const nav = $('#channelNav');
  const channels = state.data.channels;
  const totalActive = channels.filter(c => state.videoOrder.get(c.channelId)?.length).length;
  nav.innerHTML = '';
  // "All" pseudo-channel
  const all = document.createElement('button');
  all.className = 'channel-link' + (state.activeChannel === null ? ' active' : '');
  all.innerHTML = `<span class="ch-dot"></span> <span>All channels</span> <span class="ch-count">${totalActive}</span>`;
  all.onclick = () => { state.activeChannel = null; render(); };
  nav.appendChild(all);
  for (const ch of channels) {
    const btn = document.createElement('button');
    btn.className = 'channel-link' + (state.activeChannel === ch.channelId ? ' active' : '');
    btn.innerHTML = `<span class="ch-dot"></span> <span>${escapeHtml(ch.name)}</span> <span class="ch-count">${state.videoOrder.get(ch.channelId)?.length || 0}</span>`;
    btn.onclick = () => { state.activeChannel = ch.channelId; render(); };
    nav.appendChild(btn);
  }
}

function renderContent() {
  const root = $('#content');
  root.innerHTML = '';
  const channels = state.activeChannel
    ? state.data.channels.filter(c => c.channelId === state.activeChannel)
    : state.data.channels;
  for (const ch of channels) {
    const idxs = state.videoOrder.get(ch.channelId) || [];
    if (!idxs.length) continue;
    const section = document.createElement('section');
    section.className = 'section';
    section.innerHTML = `
        <div class="section-header">
          <h2>${escapeHtml(ch.name)}</h2>
          <span class="section-meta">${idxs.length} of ${ch.videos.length} videos</span>
        </div>
        <div class="grid"></div>
      `;
    const grid = section.querySelector('.grid');
    for (const i of idxs) {
      const v = ch.videos[i];
      grid.appendChild(videoCard(ch, v));
    }
    root.appendChild(section);
  }
  if (!root.children.length) {
    root.innerHTML = '<div style="color:var(--text-dim);text-align:center;padding:40px;">No videos in this channel.</div>';
  }
}

function videoCard(ch, v) {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="thumb">
      <img loading="lazy" src="${escapeAttr(v.thumbnail)}" alt="${escapeAttr(v.title)}" />
      <div class="play-overlay">
        <svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="38" fill="rgba(0,0,0,0.55)" stroke="#fff" stroke-width="2"/><polygon points="32,24 32,56 58,40" fill="#fff"/></svg>
      </div>
    </div>
    <div class="meta">
      <div class="title">${escapeHtml(v.title || 'Untitled')}</div>
      <div class="channel"><span class="ch-dot"></span> ${escapeHtml(ch.name)}${v.publishedText ? ' · ' + escapeHtml(v.publishedText) : ''}</div>
    </div>
  `;
  card.onclick = () => openPlayer(ch, v);
  return card;
}

function renderFooter() {
  $('#lastUpdated').textContent = `Updated ${formatTimeAgo(state.data.generatedAt)} · ${state.data.channels.length} channels`;
}

function formatTimeAgo(iso) {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function openPlayer(ch, v) {
  $('#playerTitle').textContent = v.title || '';
  $('#playerChannel').textContent = ch.name;
  const frame = $('#playerFrame');
  frame.innerHTML = `<iframe src="https://www.youtube.com/embed/${encodeURIComponent(v.videoId)}?autoplay=1&rel=0&modestbranding=1" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  $('#playerOverlay').classList.add('active');
  $('#playerOverlay').setAttribute('aria-hidden', 'false');
}

function closePlayer() {
  $('#playerOverlay').classList.remove('active');
  $('#playerOverlay').setAttribute('aria-hidden', 'true');
  $('#playerFrame').innerHTML = '';
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// Init
$('#shuffleBtn').onclick = reshuffle;
$('#playerClose').onclick = closePlayer;
$('#playerOverlay').onclick = (e) => { if (e.target.id === 'playerOverlay') closePlayer(); };
$('#menuToggle').onclick = () => $('#sidebar').classList.toggle('open');
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePlayer(); });

loadData().then(render).catch(e => {
  $('#content').innerHTML = `<div style="color:#f88;padding:40px;text-align:center;">Failed to load: ${escapeHtml(e.message)}</div>`;
});