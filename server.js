// server.js — web server nhỏ: phục vụ file tĩnh + nút Refresh gọi crawl.
// Chạy: npm start -> mở http://localhost:3000
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { runCrawl, sniffStreamUrl } from './crawler.js';
import { startTelegram } from './telegram.js';

const ROOT = process.cwd();
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

let crawling = false;

// Prefix route do Python FastAPI (yt-dlp-resolver) phục vụ.
const PY_PREFIXES = ['/resolve', '/play', '/dash', '/debug', '/health'];
const PY_PORT = Number(process.env.RESOLVER_PORT || 8000);

// Proxy 1-1 sang Python nội bộ, giữ nguyên method/query/headers/body (kể cả stream video).
function proxyPython(req, res) {
  const proxy = http.request(
    {
      host: '127.0.0.1',
      port: PY_PORT,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${PY_PORT}` },
    },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    },
  );
  proxy.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'resolver offline' }));
  });
  req.pipe(proxy);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // CORS cho TV app / client ngoài (TizenBrew module fetch cross-origin).
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/health') {
    let count = -1;
    try { count = JSON.parse(fs.readFileSync(path.join(ROOT, 'matches.json'), 'utf8')).length; } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, matches: count }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/crawl') {
    try {
      const r = await doCrawl();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, count: r.count, debug: r.debug }));
    } catch (e) {
      const code = e && e.code === 409 ? 409 : 500;
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String((e && e.message) || e) }));
    }
    return;
  }

  // Trạng thái crawl (TV poll tiến trình thay vì treo đợi POST /api/crawl).
  if (req.method === 'GET' && url.pathname === '/api/crawl-status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ crawling, startedAt: crawlStartedAt || null }));
    return;
  }

  // Sniff stream 1 link trận theo yêu cầu: {url} -> {ok, streamUrl}.
  if (req.method === 'POST' && url.pathname === '/api/sniff') {
    try {
      const body = await readJsonBody(req);
      const pageUrl = String((body && body.url) || '').trim();
      if (!/^https?:/i.test(pageUrl)) throw new Error('url không hợp lệ');
      const streamUrl = await sniffStreamUrl(pageUrl).catch(() => null);
      if (streamUrl) saveStreamUrl(pageUrl, streamUrl);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: !!streamUrl, streamUrl }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String((e && e.message) || e) }));
    }
    return;
  }

  // Route của yt-dlp-resolver (Python :8000) -> proxy qua Node (front-door $PORT).
  if (PY_PREFIXES.some((p) => url.pathname === p || url.pathname.startsWith(p + '/'))) {
    proxyPython(req, res);
    return;
  }

  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, path.normalize(p).replace(/^[/\\]+/, ''));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
});

const PORT = Number(process.env.PORT || 3000);
// Render/fastly: bind 0.0.0.0 để nhận traffic ngoài, local vẫn dùng localhost.
const HOST = process.env.HOST || '127.0.0.1';
server.listen(PORT, HOST, () => console.log(`Web: http://${HOST}:${PORT}`));

// Bot Telegram dùng chung logic crawl (chống chạy chồng).
// Lock tự hết hạn sau 15 phút: crawl kẹt (treo) không khóa server vĩnh viễn.
let crawlStartedAt = 0;
const CRAWL_LOCK_MS = 15 * 60 * 1000;
async function doCrawl() {
  if (crawling) {
    if (Date.now() - crawlStartedAt < CRAWL_LOCK_MS) {
      const err = new Error('Đang crawl, thử lại sau ít phút');
      err.code = 409;
      throw err;
    }
    console.log('Crawl lock quá hạn, coi như run cũ đã chết, cho chạy lại.');
  }
  crawling = true;
  crawlStartedAt = Date.now();
  try {
    return await runCrawl();
  } finally {
    crawling = false;
  }
}

function readMatches() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'matches.json'), 'utf8')); }
  catch { return []; }
}

function writeMatches(matches) {
  fs.writeFileSync(path.join(ROOT, 'matches.json'), JSON.stringify(matches.slice(0, 100), null, 2));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 65536) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(buf || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// Lưu streamUrl vào đúng link có url trùng pageUrl. Trả true nếu lưu được.
function saveStreamUrl(pageUrl, streamUrl) {
  const matches = readMatches();
  let hit = false;
  for (const m of matches) {
    for (const l of (m.links || [])) {
      if (l.url === pageUrl) { l.streamUrl = streamUrl; hit = true; }
    }
  }
  if (hit) writeMatches(matches);
  return hit;
}

// Scheduler: mỗi 5 phút sniff các trận sắp đá (15p tới) hoặc đang đá (90p),
// mỗi link chưa có streamUrl. Tối đa 2 link/lượt. Báo Telegram khi có link mới.
let sniffing = false;
async function sniffDue(notify) {
  if (sniffing || crawling) return;
  sniffing = true;
  try {
    const matches = readMatches();
    const now = Date.now();
    const due = [];
    for (const m of matches) {
      const t = new Date(m.kickoffISO).getTime();
      if (Number.isNaN(t)) continue;
      if (t - now > 15 * 60 * 1000 || now - t > 90 * 60 * 1000) continue;
      for (const l of (m.links || [])) {
        if (!l.streamUrl && /^https?:/i.test(l.url || '')) due.push({ m, l });
      }
      if (due.length >= 2) break;
    }
    let changed = false;
    for (const { m, l } of due.slice(0, 2)) {
      console.log(`Sniff: ${m.home} vs ${m.away} (${l.label})`);
      const s = await sniffStreamUrl(l.url).catch(() => null);
      if (s) {
        l.streamUrl = s;
        changed = true;
        console.log(`Sniff OK: ${s.slice(0, 100)}`);
        if (notify) notify(`🔴 Có link xem <b>${m.home} vs ${m.away}</b> (${l.label}) — mở player để xem.`);
      } else {
        console.log('Sniff: không thấy stream.');
      }
    }
    if (changed) writeMatches(matches);
  } finally {
    sniffing = false;
  }
}

const tg = startTelegram({
  token: process.env.TELEGRAM_BOT_TOKEN || '',
  allowedChats: (process.env.ALLOWED_CHAT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
  readMatches,
  onCrawl: doCrawl,
  onSniff: async (pageUrl) => {
    const streamUrl = await sniffStreamUrl(pageUrl).catch(() => null);
    if (streamUrl) saveStreamUrl(pageUrl, streamUrl);
    return streamUrl;
  },
});

// Chạy sniff nền: sau 60s đầu rồi mỗi 5 phút.
const notifyChats = (text) => { if (tg) tg.notify(text); };
setTimeout(() => sniffDue(notifyChats).catch(() => {}), 60 * 1000);
setInterval(() => sniffDue(notifyChats).catch(() => {}), 5 * 60 * 1000);
