// app.js — KidsTube client
// v3: combine 20-per-channel picks into one big shuffled list.
// v4: sidebar shows channel profile picture instead of red dot.
const state = {
  data: null,
  activeChannel: null,
  picksPerChannel: 100,
  picksByChannel: new Map(),
  flatOrder: [],
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
  state.picksByChannel.clear();
  state.flatOrder = [];
  state.data.channels.forEach((ch, chIdx) => {
    const idxs = shuffledIndices(ch.videos.length).slice(0, state.picksPerChannel);
    state.picksByChannel.set(ch.channelId, idxs);
    for (const vidIdx of idxs) {
      state.flatOrder.push({ chIdx, vidIdx });
    }
  });
  shuffleInPlace(state.flatOrder);
}

function shuffledIndices(n) {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function reshuffle() {
  seedShuffles();
  render();
  const btn = $('#shuffleBtn');
  btn.style.transform = 'rotate(360deg)';
  setTimeout(() => { btn.style.transform = ''; }, 350);
}

function render() {
  renderNav();
  renderContent();
  renderFooter();
}

function avatarHTML(ch) {
  if (!ch.avatar) return '<span class="ch-dot"></span>';
  const src = ch.avatar + '=s48-c-k-c0x00ffffff-no-rj';
  return `<img class="ch-avatar" src="${escapeAttr(src)}" alt="" loading="lazy" onerror="this.outerHTML='<span class=&quot;ch-dot&quot;></span>'" />`;
}

function renderNav() {
  const nav = $('#channelNav');
  const channels = state.data.channels;
  const totalActive = state.flatOrder.length;
  nav.innerHTML = '';

  const all = document.createElement('button');
  all.className = 'channel-link' + (state.activeChannel === null ? ' active' : '');
  all.innerHTML = avatarHTML({avatar: null}) +
    ' <span class="ch-name">All channels</span>' +
    ` <span class="ch-count">${totalActive}</span>`;
  all.onclick = () => { state.activeChannel = null; render(); };
  nav.appendChild(all);

  for (const ch of channels) {
    const btn = document.createElement('button');
    btn.className = 'channel-link' + (state.activeChannel === ch.channelId ? ' active' : '');
    const count = state.picksByChannel.get(ch.channelId)?.length || 0;
    btn.innerHTML = avatarHTML(ch) +
      ` <span class="ch-name">${escapeHtml(ch.name)}</span>` +
      ` <span class="ch-count">${count}</span>`;
    btn.onclick = () => { state.activeChannel = ch.channelId; render(); };
    nav.appendChild(btn);
  }
}

function renderContent() {
  const root = $('#content');
  root.innerHTML = '';

  if (state.activeChannel) {
    const ch = state.data.channels.find(c => c.channelId === state.activeChannel);
    if (!ch) { state.activeChannel = null; return render(); }
    const idxs = state.picksByChannel.get(ch.channelId) || [];
    const section = document.createElement('section');
    section.className = 'section';
    section.innerHTML = `
      <div class="section-header">
        <h2>${escapeHtml(ch.name)}</h2>
        <span class="section-meta">${idxs.length} of ${ch.videos.length} videos</span>
      </div>
      <div class="grid"></div>`;
    const grid = section.querySelector('.grid');
    for (const vidIdx of idxs) {
      grid.appendChild(videoCard(ch, ch.videos[vidIdx]));
    }
    root.appendChild(section);
  } else {
    const total = state.flatOrder.length;
    const section = document.createElement('section');
    section.className = 'section';
    section.innerHTML = `
      <div class="section-header">
        <h2>Today's picks</h2>
        <span class="section-meta">${total} videos · ${state.data.channels.length} channels</span>
      </div>
      <div class="grid"></div>`;
    const grid = section.querySelector('.grid');
    for (const { chIdx, vidIdx } of state.flatOrder) {
      const ch = state.data.channels[chIdx];
      grid.appendChild(videoCard(ch, ch.videos[vidIdx]));
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

let fsHintTimer = null;

function openPlayer(ch, v) {
  $('#playerTitle').textContent = v.title || '';
  $('#playerChannel').textContent = ch.name;
  const frame = $('#playerFrame');
  // v13: more conservative embed params to minimise YouTube exit points
  //   - rel=0               → no related videos from other channels at end
  //   - modestbranding=1    → small YouTube text instead of big logo
  //   - playsinline=0       → iOS/Android attempt to launch fullscreen
  //   - disablekb=1         → no keyboard navigation (kid can't arrow-key around)
  //   - iv_load_policy=3    → hide annotations
  //   - cc_load_policy=0    → no captions overlay by default
  frame.innerHTML = `<iframe src="https://www.youtube.com/embed/${encodeURIComponent(v.videoId)}?autoplay=1&rel=0&modestbranding=1&playsinline=0&disablekb=1&iv_load_policy=3&cc_load_policy=0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`;
  $('#playerOverlay').classList.add('active');
  $('#playerOverlay').setAttribute('aria-hidden', 'false');
  showFsHint();
}

function showFsHint() {
  clearTimeout(fsHintTimer);
  const hint = $('#fsHint');
  hint.setAttribute('aria-hidden', 'false');
  hint.classList.remove('visible', 'fade');
  // Show after a frame so transition fires reliably
  requestAnimationFrame(() => {
    hint.classList.add('visible');
    // Auto-disappear 3s after playback starts (≈3s after open since autoplay is immediate)
    fsHintTimer = setTimeout(() => {
      hint.classList.add('fade');
    }, 3000);
  });
}

function closePlayer() {
  clearTimeout(fsHintTimer);
  $('#playerOverlay').classList.remove('active');
  $('#playerOverlay').setAttribute('aria-hidden', 'true');
  $('#playerFrame').innerHTML = '';
  const hint = $('#fsHint');
  hint.classList.remove('visible', 'fade');
  hint.setAttribute('aria-hidden', 'true');
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

$('#shuffleBtn').onclick = reshuffle;
$('#playerClose').onclick = closePlayer;
$('#playerOverlay').onclick = (e) => { if (e.target.id === 'playerOverlay') closePlayer(); };
$('#menuToggle').onclick = () => $('#sidebar').classList.toggle('open');
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePlayer(); });

// Mobile: tap outside sidebar to close it.
document.addEventListener('click', (e) => {
  const sidebar = $('#sidebar');
  if (!sidebar.classList.contains('open')) return;
  if (sidebar.contains(e.target)) return;
  if ($('#menuToggle').contains(e.target)) return;
  sidebar.classList.remove('open');
});

loadData().then(render).catch(e => {
  $('#content').innerHTML = `<div style="color:#f88;padding:40px;text-align:center;">Failed to load: ${escapeHtml(e.message)}</div>`;
});