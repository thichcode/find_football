// app.js
let ALL = [];
let onlyLive = false;
const qEl = document.getElementById('q');
const liveBtn = document.getElementById('liveBtn');
const leagueEl = document.getElementById('league');
const sourceEl = document.getElementById('source');
const listEl = document.getElementById('list');

const SRC_NAMES = { socolive: 'Socolive', gavang: 'GavangTV', xoilac: 'Xoilac', manual: 'Link tay' };
const srcName = (id) => SRC_NAMES[id] || id;

// Lọc theo web: trận nào có ít nhất 1 link thuộc web đó (kể cả trận gộp link nhiều nguồn).
function matchHasSource(m, src) {
  if ((m.source || '') === src) return true;
  return (m.links || []).some((l) => {
    try { return new URL(l.url).hostname.toLowerCase().includes(src); } catch { return false; }
  });
}

function favs() { return JSON.parse(localStorage.getItem('favTeams') || '[]'); }
function toggleFav(t) {
  let f = favs();
  f = f.includes(t) ? f.filter((x) => x !== t) : [...f, t];
  localStorage.setItem('favTeams', JSON.stringify(f));
  render();
}

function googleUrl(m) {
  return 'https://www.google.com/search?q=' + encodeURIComponent(`${m.home} vs ${m.away} trực tiếp socolive gavang`);
}

function fmtTime(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

function todayGMT7() {
  const d = new Date();
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  return new Date(utc + 7 * 3600000).toISOString().slice(0, 10);
}

// Xử lý nút Lấy link m3u8
async function handleGetLink(btn, pageUrl, title) {
  btn.disabled = true;
  btn.classList.add('loading');
  btn.textContent = '⏳ Đang lấy...';

  try {
    const res = await fetch('/api/sniff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: pageUrl }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));

    if (data.streamUrl) {
      // Cập nhật lại trong danh sách ALL
      for (const m of ALL) {
        for (const l of (m.links || [])) {
          if (l.url === pageUrl) l.streamUrl = data.streamUrl;
        }
      }

      // Tạo nút Phát thay thế nút Get link
      const playA = document.createElement('a');
      playA.className = 'play-btn-link';
      playA.href = `player.html?src=${encodeURIComponent(data.streamUrl)}&t=${encodeURIComponent(title)}`;
      playA.target = '_blank';
      playA.rel = 'noopener';
      playA.title = 'Phát stream m3u8 trên Player';
      playA.textContent = '▶ Phát';
      btn.replaceWith(playA);
    } else {
      btn.classList.remove('loading');
      btn.classList.add('error');
      btn.disabled = false;
      btn.textContent = '❌ Thử lại';
      alert('Chưa dò được stream m3u8 cho BLV này (có thể trận chưa đá hoặc nguồn chưa mở luồng). Bạn thử lại sau hoặc bấm tên BLV để mở trang web.');
    }
  } catch (err) {
    btn.classList.remove('loading');
    btn.classList.add('error');
    btn.disabled = false;
    btn.textContent = '❌ Thử lại';
    alert('Lỗi lấy stream: ' + err.message);
  }
}

function render() {
  const q = qEl.value.trim().toLowerCase();
  const lg = leagueEl.value;
  const sc = sourceEl.value;
  const f = favs();
  const today = todayGMT7();
  const rows = ALL.filter((m) => {
    if (onlyLive && !m.isLive) return false;
    if (lg !== 'all' && m.league !== lg) return false;
    if (sc !== 'all' && !matchHasSource(m, sc)) return false;
    // Chi hien tran hom nay (GMT+7) — ca da xong, khong ẩn.
    if (String(m.kickoffISO).slice(0, 10) !== today) return false;
    if (q && !`${m.home} ${m.away} ${m.league}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => new Date(a.kickoffISO) - new Date(b.kickoffISO));

  listEl.innerHTML = rows.length ? '' : '<p>Không có trận. Thử xóa filter.</p>';
  for (const m of rows) {
    const div = document.createElement('div');
    div.className = 'card';
    const star = f.includes(m.home) ? '★' : '☆';

    div.innerHTML = `<span class="fav" data-t="${m.home}">${star}</span>
      <div>${m.isLive ? '<span class="live">🔴 LIVE</span> ' : ''}<b>${fmtTime(m.kickoffISO)}</b> — ${m.home} vs ${m.away} <small>(${m.league})</small></div>
      <div class="links-row"></div>`;

    const linksRow = div.querySelector('.links-row');
    for (const l of (m.links || [])) {
      const title = `${m.home} vs ${m.away} (${l.label})`;
      const tag = document.createElement('span');
      tag.className = 'play-tag';

      const webA = document.createElement('a');
      webA.className = 'web-link';
      webA.href = l.url;
      webA.target = '_blank';
      webA.rel = 'noopener';
      webA.title = 'Mở trang web';
      webA.textContent = l.label;
      tag.appendChild(webA);

      if (l.streamUrl) {
        const playA = document.createElement('a');
        playA.className = 'play-btn-link';
        playA.href = `player.html?src=${encodeURIComponent(l.streamUrl)}&t=${encodeURIComponent(title)}`;
        playA.target = '_blank';
        playA.rel = 'noopener';
        playA.title = 'Phát stream m3u8 trên Player';
        playA.textContent = '▶ Phát';
        tag.appendChild(playA);
      } else {
        const getBtn = document.createElement('button');
        getBtn.className = 'get-btn';
        getBtn.title = 'Lấy link m3u8 để phát';
        getBtn.textContent = '⚡ Lấy m3u8';
        getBtn.onclick = () => handleGetLink(getBtn, l.url, title);
        tag.appendChild(getBtn);
      }

      linksRow.appendChild(tag);
    }

    const gA = document.createElement('a');
    gA.className = 'google-link';
    gA.href = googleUrl(m);
    gA.target = '_blank';
    gA.rel = 'noopener';
    gA.textContent = '🔍 Google';
    linksRow.appendChild(gA);

    div.querySelector('.fav').onclick = (e) => toggleFav(e.target.dataset.t);
    listEl.appendChild(div);
  }
}

async function load() {
  const res = await fetch('matches.json');
  ALL = await res.json();
  const leagues = [...new Set(ALL.map((m) => m.league))];
  leagueEl.innerHTML = '<option value="all">Mọi giải</option>' + leagues.map((l) => `<option>${l}</option>`).join('');
  const srcIds = [...new Set(ALL.map((m) => m.source).filter(Boolean))];
  sourceEl.innerHTML = '<option value="all">Mọi web</option>' + srcIds.map((s) => `<option value="${s}">${srcName(s)}</option>`).join('');
  render();
}

qEl.oninput = render;
leagueEl.onchange = render;
sourceEl.onchange = render;
liveBtn.onclick = () => { onlyLive = !onlyLive; liveBtn.style.borderColor = onlyLive ? '#e53e3e' : '#333'; render(); };
document.getElementById('refresh').onclick = async (e) => {
  const btn = e.target;
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Đang crawl...';
  try {
    const res = await fetch('/api/crawl', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    // 202 = crawl chay nen -> poll cho xong
    if (data.started) {
      btn.textContent = '⏳ Đang crawl...';
      let tries = 0;
      while (tries < 80) {
        await new Promise(r => setTimeout(r, 3000));
        tries++;
        btn.textContent = `⏳ Đang crawl... ${tries * 3}s`;
        const st = await fetch('/api/crawl-status').then(r => r.json()).catch(() => ({ crawling: false }));
        if (!st.crawling) break;
      }
    }
    await load();
    alert(`Crawl xong: ${ALL.length} trận`);
  } catch (err) {
    alert('Crawl lỗi — bạn đang mở web bằng node server.js (npm start) chưa? ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
};
load();
