// server.js — web server nhỏ: phục vụ file tĩnh + nút Refresh gọi crawl.
// Chạy: npm start -> mở http://localhost:3000
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { runCrawl } from './crawler.js';
import { startTelegram } from './telegram.js';

const ROOT = process.cwd();
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

let crawling = false;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

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
      res.end(JSON.stringify({ ok: true, count: r.count }));
    } catch (e) {
      const code = e && e.code === 409 ? 409 : 500;
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String((e && e.message) || e) }));
    }
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
async function doCrawl() {
  if (crawling) {
    const err = new Error('Đang crawl, thử lại sau ít phút');
    err.code = 409;
    throw err;
  }
  crawling = true;
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

startTelegram({
  token: process.env.TELEGRAM_BOT_TOKEN || '',
  allowedChats: (process.env.ALLOWED_CHAT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
  readMatches,
  onCrawl: doCrawl,
});
