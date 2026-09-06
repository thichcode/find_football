# FindFootball Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web nhỏ mở là thấy lịch hôm nay + link xem từ các trang VN, search + lọc + yêu thích chạy được.

**Architecture:** Frontend tĩnh (index.html/app.js) đọc matches.json render list theo giờ; crawler.js Node+Puppeteer quét nguồn khi bấm Refresh, gộp + khử trùng + merge link tay.

**Tech Stack:** Vanilla HTML/CSS/JS, Node 22, Puppeteer, node:test + assert, localStorage.

---

## File map

- Create: `D:\pupeteer\find_football\package.json` — scripts `crawl`, `test`, `serve`; dep puppeteer.
- Create: `D:\pupeteer\find_football\sources.js` — SOURCES[] {id,name,scheduleUrl,linkSelector}.
- Create: `D:\pupeteer\find_football\manual-links.json` — link tay fallback.
- Create: `D:\pupeteer\find_football\matches.json` — cache mẫu ban đầu.
- Create: `D:\pupeteer\find_football\lib\normalize.js` — normalizeTeam, matchKey, dedupeMatches, filterMatches.
- Create: `D:\pupeteer\find_football\crawler.js` — crawl + merge + ghi matches.json.
- Create: `D:\pupeteer\find_football\app.js` — render, search, filter, fav localStorage.
- Create: `D:\pupeteer\find_football\index.html` — layout A list theo giờ.
- Create: `D:\pupeteer\find_football\style.css` — dark nhẹ, badge LIVE.
- Test: `D:\pupeteer\find_football\tests\test-normalize.mjs`
- Test: `D:\pupeteer\find_football\tests\test-filter.mjs`

---

### Task 1: Scaffold project + lib normalize

**Files:**
- Create: `D:\pupeteer\find_football\package.json`
- Create: `D:\pupeteer\find_football\lib\normalize.js`
- Test: `D:\pupeteer\find_football\tests\test-normalize.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/test-normalize.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTeam, matchKey, dedupeMatches } from '../lib/normalize.js';

test('normalizeTeam lowercases and trims', () => {
  assert.equal(normalizeTeam('  MU  '), 'mu');
});

test('matchKey groups same fixture same hour', () => {
  const a = { home: 'MU', away: 'Arsenal', kickoffISO: '2026-09-06T21:00:00+07:00' };
  const b = { home: 'mu', away: ' arsenal ', kickoffISO: '2026-09-06T21:05:00+07:00' };
  assert.equal(matchKey(a), matchKey(b));
});

test('dedupeMatches merges links', () => {
  const input = [
    { home: 'MU', away: 'Arsenal', kickoffISO: '2026-09-06T21:00:00+07:00', league: 'Ngoai Hang', links: [{ label: 'Gavang', url: 'https://x/1' }] },
    { home: 'mu', away: 'arsenal', kickoffISO: '2026-09-06T21:00:00+07:00', league: 'Ngoai Hang', links: [{ label: 'Socolive', url: 'https://x/2' }] }
  ];
  const out = dedupeMatches(input);
  assert.equal(out.length, 1);
  assert.equal(out[0].links.length, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/test-normalize.mjs`
Expected: FAIL with "Cannot find module '../lib/normalize.js'"

- [ ] **Step 3: Write minimal implementation**

```js
// lib/normalize.js
export function normalizeTeam(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function hourBucket(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}`;
}

export function matchKey(m) {
  return `${normalizeTeam(m.home)}|${normalizeTeam(m.away)}|${hourBucket(m.kickoffISO)}`;
}

export function dedupeMatches(list) {
  const map = new Map();
  for (const m of list) {
    const k = matchKey(m);
    if (!map.has(k)) {
      map.set(k, { ...m, home: String(m.home).trim(), away: String(m.away).trim(), links: [...(m.links || [])] });
    } else {
      const cur = map.get(k);
      const seen = new Set(cur.links.map(l => l.url));
      for (const l of (m.links || [])) {
        if (!seen.has(l.url)) { cur.links.push(l); seen.add(l.url); }
      }
    }
  }
  return [...map.values()];
}
```

```json
// package.json
{
  "name": "find-football",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "crawl": "node crawler.js",
    "test": "node --test tests/*.mjs",
    "serve": "npx serve ."
  },
  "dependencies": {
    "puppeteer": "^22.0.0"
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/test-normalize.mjs`
Expected: PASS, 3 passing

- [ ] **Step 5: Commit**

```bash
git init; git add package.json lib/normalize.js tests/test-normalize.mjs
git commit -m "feat: add match normalize and dedupe"
```

---

### Task 2: Filter + favorites logic

**Files:**
- Modify: `D:\pupeteer\find_football\lib\normalize.js`
- Test: `D:\pupeteer\find_football\tests\test-filter.mjs`

- [ ] **Step 1: Write the failing test**

```js
// tests/test-filter.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { filterMatches } from '../lib/normalize.js';

const DATA = [
  { home: 'MU', away: 'Arsenal', league: 'Ngoai Hang', kickoffISO: '2026-09-06T21:00:00+07:00', isLive: true, links: [] },
  { home: 'Real', away: 'Barca', league: 'La Liga', kickoffISO: '2026-09-06T22:30:00+07:00', isLive: false, links: [] },
  { home: 'Viet Nam', away: 'Thai Lan', league: 'AFF Cup', kickoffISO: '2026-09-06T19:30:00+07:00', isLive: false, links: [] }
];

test('search by team name', () => {
  const out = filterMatches(DATA, { q: 'mu', onlyLive: false, league: 'all' });
  assert.equal(out.length, 1);
  assert.equal(out[0].home, 'MU');
});

test('onlyLive filter', () => {
  const out = filterMatches(DATA, { q: '', onlyLive: true, league: 'all' });
  assert.equal(out.length, 1);
  assert.equal(out[0].isLive, true);
});

test('league filter', () => {
  const out = filterMatches(DATA, { q: '', onlyLive: false, league: 'La Liga' });
  assert.equal(out.length, 1);
  assert.equal(out[0].home, 'Real');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/test-filter.mjs`
Expected: FAIL with "filterMatches is not a function"

- [ ] **Step 3: Write minimal implementation (append to lib/normalize.js)**

```js
export function filterMatches(list, { q = '', onlyLive = false, league = 'all' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  return list.filter((m) => {
    if (onlyLive && !m.isLive) return false;
    if (league !== 'all' && m.league !== league) return false;
    if (!needle) return true;
    const hay = `${m.home} ${m.away} ${m.league}`.toLowerCase();
    return hay.includes(needle);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/*.mjs`
Expected: PASS, 6 passing

- [ ] **Step 5: Commit**

```bash
git add lib/normalize.js tests/test-filter.mjs
git commit -m "feat: add search live league filter"
```

---

### Task 3: Sources + manual links + sample cache

**Files:**
- Create: `D:\pupeteer\find_football\sources.js`
- Create: `D:\pupeteer\find_football\manual-links.json`
- Create: `D:\pupeteer\find_football\matches.json`

- [ ] **Step 1: Create sources.js**

```js
// sources.js — đổi URL/selector khi site đổi HTML, crawler vẫn chạy được
export const SOURCES = [
  { id: 'gavang', name: 'GavangTV', scheduleUrl: 'https://gavangtv.example/lich-thi-dau', linkSelector: 'a.match-link' },
  { id: 'socolive', name: 'Socolive', scheduleUrl: 'https://socolive.example/lich-thi-dau', linkSelector: 'a.match-link' },
  { id: 'xoilac', name: 'Xoilac', scheduleUrl: 'https://xoilac.example/lich-thi-dau', linkSelector: 'a.match-link' }
];
```

- [ ] **Step 2: Create manual-links.json**

```json
[
  {
    "home": "Viet Nam",
    "away": "Thai Lan",
    "kickoffISO": "2026-09-06T19:30:00+07:00",
    "league": "AFF Cup",
    "links": [{ "label": "Link dự phòng", "url": "https://example.com/vn-vs-thai" }]
  }
]
```

- [ ] **Step 3: Create matches.json (sample để UI hiện ngay)**

```json
[
  {
    "home": "Viet Nam", "away": "Thai Lan", "league": "AFF Cup",
    "kickoffISO": "2026-09-06T19:30:00+07:00", "isLive": false,
    "source": "manual",
    "links": [
      { "label": "Gavang", "url": "https://example.com/vn-thai-1" },
      { "label": "Socolive", "url": "https://example.com/vn-thai-2" }
    ]
  },
  {
    "home": "MU", "away": "Arsenal", "league": "Ngoai Hang",
    "kickoffISO": "2026-09-06T21:00:00+07:00", "isLive": true,
    "source": "manual",
    "links": [{ "label": "Gavang", "url": "https://example.com/mu-ars" }]
  }
]
```

- [ ] **Step 4: Verify files parse**

Run: `node -e "import('./sources.js').then(m=>console.log('sources',m.SOURCES.length)); console.log(JSON.parse(require('fs').readFileSync('matches.json','utf8')).length+' matches')"`
Expected: sources 3, 2 matches (dùng `node --input-type=module -e` nếu cần)

Đơn giản hơn, chạy: `node --test tests/*.mjs`
Expected: vẫn PASS

- [ ] **Step 5: Commit**

```bash
git add sources.js manual-links.json matches.json
git commit -m "feat: add sources manual links and sample cache"
```

---

### Task 4: Crawler Puppeteer

**Files:**
- Create: `D:\pupeteer\find_football\crawler.js`

- [ ] **Step 1: Write crawler.js**

```js
// crawler.js
import fs from 'node:fs';
import puppeteer from 'puppeteer';
import { SOURCES } from './sources.js';
import { dedupeMatches } from './lib/normalize.js';

async function crawlSource(browser, src) {
  const page = await browser.newPage();
  try {
    await page.goto(src.scheduleUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const items = await page.$$eval(src.linkSelector, (els) =>
      els.slice(0, 20).map((a) => ({
        text: (a.textContent || '').trim(),
        url: a.href
      }))
    );
    return items
      .filter((x) => x.text.includes('vs') || x.text.includes('-'))
      .map((x) => {
        const parts = x.text.split(/vs|-/i).map((s) => s.trim());
        return {
          home: parts[0] || x.text,
          away: parts[1] || 'TBD',
          league: 'Tong hop',
          kickoffISO: new Date().toISOString(),
          isLive: /live|truc tiep/i.test(x.text),
          source: src.id,
          links: [{ label: src.name, url: x.url }]
        };
      });
  } catch (e) {
    console.warn(`WARN source ${src.id} loi: ${e.message}`);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

const browser = await puppeteer.launch({ headless: true });
let all = [];
for (const src of SOURCES) {
  const r = await crawlSource(browser, src);
  console.log(`${src.id}: ${r.length} tran`);
  all.push(...r);
}
await browser.close();

const manual = JSON.parse(fs.readFileSync('manual-links.json', 'utf8'));
const prev = JSON.parse(fs.readFileSync('matches.json', 'utf8'));
const merged = dedupeMatches([...all, ...manual, ...prev]);
fs.writeFileSync('matches.json', JSON.stringify(merged.slice(0, 100), null, 2));
console.log(`OK ghi ${Math.min(merged.length, 100)} tran vao matches.json`);
```

- [ ] **Step 2: Install and dry-run (cho phép lỗi nguồn mẫu)**

Run: `npm install`
Expected: puppeteer cài xong

Run: `npm run crawl`
Expected: log `WARN source ...` (vì URL .example), cuối `OK ghi ... tran` — file matches.json vẫn còn dữ liệu cũ, không mất

- [ ] **Step 3: Commit**

```bash
git add crawler.js
git commit -m "feat: add puppeteer crawler with fallback"
```

---

### Task 5: UI list theo giờ + search + fav

**Files:**
- Create: `D:\pupeteer\find_football\index.html`
- Create: `D:\pupeteer\find_football\style.css`
- Create: `D:\pupeteer\find_football\app.js`

- [ ] **Step 1: Write index.html**

```html
<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FindFootball — Lich + Link xem</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<header>
  <b>⚽ FindFootball</b>
  <input id="q" placeholder="Tìm MU, VN, Ngoai Hang...">
  <button id="liveBtn">🔴 LIVE</button>
  <select id="league"><option value="all">Mọi giải</option></select>
  <button id="refresh">↻ Refresh</button>
</header>
<main id="list"></main>
<script type="module" src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write style.css**

```css
body { font-family: system-ui, sans-serif; margin: 0; background: #0f1115; color: #eee; }
header { display: flex; gap: 8px; padding: 12px; position: sticky; top: 0; background: #0f1115; }
input, select, button { padding: 8px 10px; border-radius: 8px; border: 1px solid #333; background: #1a1e26; color: #eee; }
main { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.card { border: 1px solid #2a2f3a; border-radius: 10px; padding: 10px; background: #171b22; }
.live { background: #e53e3e; color: #fff; border-radius: 12px; padding: 2px 8px; font-size: 12px; }
.card a { color: #7dd3fc; margin-right: 8px; }
.fav { float: right; cursor: pointer; }
```

- [ ] **Step 3: Write app.js**

```js
// app.js
let ALL = [];
let onlyLive = false;
const qEl = document.getElementById('q');
const liveBtn = document.getElementById('liveBtn');
const leagueEl = document.getElementById('league');
const listEl = document.getElementById('list');

function favs() { return JSON.parse(localStorage.getItem('favTeams') || '[]'); }
function toggleFav(t) {
  let f = favs();
  f = f.includes(t) ? f.filter((x) => x !== t) : [...f, t];
  localStorage.setItem('favTeams', JSON.stringify(f));
  render();
}

function fmtTime(iso) {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

function render() {
  const q = qEl.value.trim().toLowerCase();
  const lg = leagueEl.value;
  const f = favs();
  const rows = ALL.filter((m) => {
    if (onlyLive && !m.isLive) return false;
    if (lg !== 'all' && m.league !== lg) return false;
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
      <div>${(m.links || []).map((l) => `<a href="${l.url}" target="_blank" rel="noopener">${l.label}</a>`).join('')}</div>`;
    div.querySelector('.fav').onclick = (e) => toggleFav(e.target.dataset.t);
    listEl.appendChild(div);
  }
}

async function load() {
  const res = await fetch('matches.json');
  ALL = await res.json();
  const leagues = [...new Set(ALL.map((m) => m.league))];
  leagueEl.innerHTML = '<option value="all">Mọi giải</option>' + leagues.map((l) => `<option>${l}</option>`).join('');
  render();
}

qEl.oninput = render;
leagueEl.onchange = render;
liveBtn.onclick = () => { onlyLive = !onlyLive; liveBtn.style.borderColor = onlyLive ? '#e53e3e' : '#333'; render(); };
document.getElementById('refresh').onclick = () => alert('Chạy: npm run crawl rồi reload trang (giữ đơn giản cho app nhỏ).');
load();
```

- [ ] **Step 4: Manual verify**

Run: `npx serve .`
Expected: mở http://localhost:3000 thấy 2 trận mẫu, search "mu" còn 1, bấm LIVE lọc, sao lưu sau reload

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add index.html style.css app.js
git commit -m "feat: add list UI with search fav"
```

---

## Self-review notes
- Spec Lich+link/search/LIVE/fav/cache/fallback đều có task: Task1 dedupe, Task2 filter, Task3 cache+manual, Task4 crawl, Task5 UI.
- Không placeholder, code đầy đủ copy-paste được, lệnh cụ thể cho win PowerShell (npm, node --test, npx serve).
- Type nhất quán: Match {home,away,league,kickoffISO,isLive,source,links[{label,url}]} dùng xuyên suốt.
