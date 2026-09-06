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

function render() {
  const q = qEl.value.trim().toLowerCase();
  const lg = leagueEl.value;
  const sc = sourceEl.value;
  const f = favs();
  const rows = ALL.filter((m) => {
    if (onlyLive && !m.isLive) return false;
    if (lg !== 'all' && m.league !== lg) return false;
    if (sc !== 'all' && !matchHasSource(m, sc)) return false;
    // Ẩn trận đã đá xong (giờ đá + 120 phút < hiện tại). Trận đang diễn ra vẫn hiện.
    const t = new Date(m.kickoffISO).getTime();
    if (!Number.isNaN(t) && t + 120 * 60 * 1000 < Date.now()) return false;
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
      <div>${(m.links || []).map((l) => `<a href="${l.url}" target="_blank" rel="noopener">${l.label}</a>`).join('')}<a href="${googleUrl(m)}" target="_blank" rel="noopener">🔍 Google</a></div>`;
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
    await load();
    alert(`Crawl xong: ${data.count} trận`);
  } catch (err) {
    alert('Crawl lỗi — bạn đang mở web bằng node server.js (npm start) chưa? ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
};
load();
