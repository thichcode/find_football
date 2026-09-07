// telegram.js — bot Telegram fetch có sẵn, KHÔNG thêm dependency.
// Lệnh: /help /live /tomorrow /next /stats /web /fav /favs /crawl /cancel /resolve /debug /ai /ask
// Resolver proxy qua Node (:8000 nội bộ). AI gọi OpenRouter trực tiếp.

const MAX_MSG = 3800;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const AI_MODEL = process.env.AI_MODEL || 'mistralai/mistral-7b-instruct:free';
const AI_PROVIDER_URL = process.env.AI_PROVIDER_URL || 'https://openrouter.ai/api/v1/chat/completions';

export function parseCommand(text) {
  const t = String(text || '').trim();
  if (!t.startsWith('/')) return null;
  const [cmd, ...rest] = t.slice(1).split(/\s+/);
  return { cmd: cmd.toLowerCase().split('@')[0], arg: rest.join(' ').trim() };
}

// ── helpers ──────────────────────────────────────────────────────

function timeStr(iso) {
  const d = new Date(iso);
  return Number.isNaN(d) ? '?' : d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

function nowPlus(h = 0) {
  return Date.now() + h * 3600_000;
}

function isLiveMatch(m) {
  const t = new Date(m.kickoffISO).getTime();
  return !Number.isNaN(t) && t <= Date.now() && Date.now() - t < 2 * 3600_000;
}

function upcoming(matches, limit = 5, needle = '') {
  const n = needle.toLowerCase();
  return matches
    .filter((m) => {
      const t = new Date(m.kickoffISO).getTime();
      const ok = Number.isNaN(t) || t + 2 * 3600_000 >= Date.now();
      return ok && (!n || `${m.home} ${m.away} ${m.league}`.toLowerCase().includes(n));
    })
    .sort((a, b) => new Date(a.kickoffISO) - new Date(b.kickoffISO))
    .slice(0, limit);
}

function formatRow(m) {
  const lines = [`⚽ <b>${esc(m.home)} vs ${esc(m.away)}</b>  (${timeStr(m.kickoffISO)})`];
  const league = m.league || '';
  if (league) lines.push(`  🏆 ${esc(league)}`);
  for (const l of (m.links || []).slice(0, 6)) lines.push(`  • <a href="${esc(l.url)}">${esc(l.label || l.url)}</a>`);
  return lines.join('\n');
}

function formatRows(matches, header = '') {
  if (!matches.length) return 'Không có trận nào.';
  const parts = header ? [header] : [];
  for (const m of matches) {
    const chunk = formatRow(m) + '\n';
    if (parts.join('\n').length + chunk.length > MAX_MSG) break;
    parts.push(chunk);
  }
  return parts.join('\n').trim();
}

function parseFavKey(team) {
  return team.toLowerCase().trim().replace(/\s+/g, ' ');
}

// ── storage (JSON file, không thêm dep) ──────────────────────────

import fs from 'node:fs';
import path from 'node:path';

const FAV_PATH = path.join(process.cwd(), 'favs.json');

function readFavs() {
  try { return JSON.parse(fs.readFileSync(FAV_PATH, 'utf8')); }
  catch { return {}; }
}

function writeFavs(data) {
  fs.writeFileSync(FAV_PATH, JSON.stringify(data, null, 2));
}

function getFavs(chatId) {
  const db = readFavs();
  return db[String(chatId)] || [];
}

function toggleFav(chatId, team) {
  const db = readFavs();
  const key = String(chatId);
  const arr = db[key] || [];
  const k = parseFavKey(team);
  const idx = arr.findIndex((t) => parseFavKey(t) === k);
  if (idx >= 0) { arr.splice(idx, 1); } else { arr.push(team); }
  db[key] = arr;
  writeFavs(db);
  return idx < 0;
}

// ── resolver proxy ───────────────────────────────────────────────

async function resolverFetch(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `http://127.0.0.1:8000${path}${qs ? '?' + qs : ''}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { ok: false, error: text.slice(0, 500) }; }
}

// ── commands ─────────────────────────────────────────────────────

const COMMANDS = [
  ['/help', 'Danh sách lệnh'],
  ['/live', 'Trận đang LIVE'],
  ['/tomorrow', 'Trận ngày mai'],
  ['/next', '5 trận sắp tới'],
  ['/next <đội>', 'Trận tiếp theo của đội'],
  ['/stats', 'Thống kê trận/giải/web'],
  ['/web', 'Danh sách web đang dùng'],
  ['/fav <đội>', 'Thêm/xoá đội yêu thích'],
  ['/favs', 'Xem danh sách yêu thích'],
  ['/crawl', 'Crawl lịch + link mới'],
  ['/cancel', 'Huỷ crawl đang chạy'],
  ['/resolve <url>', 'Lấy link video trực tiếp'],
  ['/debug <url>', 'Debug yt-dlp output'],
  ['/ai <câu hỏi>', 'Chat AI về bóng đá'],
  ['/ask <url>', 'AI phân tích video'],
];

function handleHelp(chatId, send) {
  const lines = ['<b>📋 Danh sách lệnh:</b>\n'];
  for (const [cmd, desc] of COMMANDS) lines.push(`<code>${esc(cmd)}</code> — ${esc(desc)}`);
  return send(chatId, lines.join('\n'));
}

function handleLive(chatId, send, readMatches) {
  const live = readMatches().filter(isLiveMatch);
  if (!live.length) return send(chatId, 'Không có trận nào đang LIVE.');
  return send(chatId, formatRows(live, `🔴 <b>Đang LIVE (${live.length}):</b>\n`));
}

function handleTomorrow(chatId, send, readMatches) {
  const tomorrow = readMatches().filter((m) => {
    const d = new Date(m.kickoffISO);
    const now = new Date();
    return d.getDate() === now.getDate() + 1 && d.getMonth() === now.getMonth();
  });
  return send(chatId, formatRows(tomorrow, `📅 <b>Ngày mai (${tomorrow.length}):</b>\n`));
}

function handleNext(chatId, send, readMatches, arg) {
  const rows = upcoming(readMatches(), 5, arg);
  const header = arg ? `🔍 <b>Trận tiếp theo của "${esc(arg)}":</b>\n` : `⏭️ <b>5 trận sắp tới:</b>\n`;
  return send(chatId, formatRows(rows, header));
}

function handleStats(chatId, send, readMatches) {
  const matches = readMatches();
  const leagues = new Set(matches.map((m) => m.league).filter(Boolean));
  const sources = new Set();
  for (const m of matches) for (const l of m.links || []) {
    try { sources.add(new URL(l.url).hostname); } catch {}
  }
  const live = matches.filter(isLiveMatch).length;
  return send(chatId, [
    '📊 <b>Thống kê:</b>',
    `• Tổng trận: <b>${matches.length}</b>`,
    `• Đang LIVE: <b>${live}</b>`,
    `• Số giải: <b>${leagues.size}</b>`,
    `• Số web: <b>${sources.size}</b>`,
  ].join('\n'));
}

function handleWeb(chatId, send, readMatches) {
  const matches = readMatches();
  const map = {};
  for (const m of matches) for (const l of m.links || []) {
    try {
      const host = new URL(l.url).hostname;
      map[host] = (map[host] || 0) + 1;
    } catch {}
  }
  const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return send(chatId, 'Không có web nào.');
  const lines = ['🌐 <b>Web hiện có:</b>\n'];
  for (const [host, count] of sorted.slice(0, 20)) lines.push(`• <code>${esc(host)}</code> (${count} link)`);
  return send(chatId, lines.join('\n'));
}

function handleFav(chatId, send, arg, readMatches) {
  if (!arg) return send(chatId, 'Cú pháp: <code>/fav tên đội</code>\nVí dụ: /fav MU\nGõ lại để xoá.');
  const added = toggleFav(chatId, arg);
  if (added) return send(chatId, `⭐ Đã thêm "<b>${esc(arg)}</b>" vào yêu thích.\nGõ /fav lại để xoá.`);
  return send(chatId, `🗑️ Đã xoá "<b>${esc(arg)}</b>" khỏi yêu thích.`);
}

function handleFavs(chatId, send) {
  const favs = getFavs(chatId);
  if (!favs.length) return send(chatId, 'Chưa có yêu thích. Dùng /fav tên đội để thêm.');
  return send(chatId, `⭐ <b>Yêu thích (${favs.length}):</b>\n${favs.map((t) => `• ${esc(t)}`).join('\n')}`);
}

function handleCrawl(chatId, send, onCrawl) {
  send(chatId, '⏳ Đang crawl, đợi 1-2 phút...');
  return onCrawl()
    .then((r) => send(chatId, `✅ Crawl xong: <b>${r.count}</b> trận.\nGõ /next hoặc /live để xem.`))
    .catch((e) => send(chatId, '❌ Crawl lỗi: ' + String((e && e.message) || e).slice(0, 300)));
}

function handleResolve(chatId, send, arg) {
  if (!arg) return send(chatId, 'Cú pháp: <code>/resolve url</code>\nHỗ trợ: YouTube, TikTok, Facebook, Bilibili');
  return resolverFetch('/resolve', { url: arg })
    .then((r) => {
      if (!r.ok) return send(chatId, `❌ ${esc(r.error || 'Resolve thất bại')}`);
      const v = r.resolved;
      return send(chatId, [
        `🎬 <b>${esc(v.title)}</b>`,
        `📥 <a href="${esc(v.videoUrl)}">Link video</a>`,
        v.thumbnailUrl ? `🖼 <a href="${esc(v.thumbnailUrl)}">Thumbnail</a>` : '',
      ].filter(Boolean).join('\n'));
    })
    .catch((e) => send(chatId, '❌ Resolver offline: ' + String(e.message).slice(0, 200)));
}

function handleDebug(chatId, send, arg) {
  if (!arg) return send(chatId, 'Cú pháp: <code>/debug url</code>');
  return resolverFetch('/debug', { url: arg })
    .then((r) => {
      if (!r.ok) return send(chatId, `❌ ${esc(r.error || 'Debug thất bại')}\n${esc(r.stderr || '')}`.slice(0, MAX_MSG));
      const out = r.yt_dlp_output || {};
      return send(chatId, [
        `🔍 <b>Debug output:</b>`,
        `<code>${esc(JSON.stringify(out, null, 2))}</code>`,
      ].join('\n').slice(0, MAX_MSG));
    })
    .catch((e) => send(chatId, '❌ Resolver offline: ' + String(e.message).slice(0, 200)));
}

// ── AI (OpenRouter) ─────────────────────────────────────────────

async function aiChat(messages) {
  const res = await fetch(AI_PROVIDER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
    },
    body: JSON.stringify({ model: AI_MODEL, messages, max_tokens: 1024 }),
    signal: AbortSignal.timeout(60_000),
  });
  const j = await res.json();
  return j.choices?.[0]?.message?.content || j.error?.message || 'AI không trả lời.';
}

function buildMatchContext(readMatches) {
  const matches = readMatches().slice(0, 30);
  if (!matches.length) return 'Không có trận nào.';
  return matches.map((m) => {
    const t = timeStr(m.kickoffISO);
    return `${m.home} vs ${m.away} (${m.league || '?'}) lúc ${t}`;
  }).join('\n');
}

async function handleAI(chatId, send, arg, readMatches) {
  if (!OPENROUTER_KEY) return send(chatId, 'Chưa set OPENROUTER_API_KEY.');
  if (!arg) return send(chatId, 'Cú pháp: <code>/ai câu hỏi</code>\nVí dụ: /ai MU đá trận nào sắp tới?');
  const context = buildMatchContext(readMatches);
  const reply = await aiChat([
    { role: 'system', content: `Bạn là trợ lý bóng đá. Dữ liệu trận hiện tại:\n${context}\nTrả lời ngắn gọn bằng tiếng Việt.` },
    { role: 'user', content: arg },
  ]);
  return send(chatId, `🤖 <b>AI:</b>\n${esc(reply)}`);
}

async function handleAsk(chatId, send, arg, readMatches) {
  if (!OPENROUTER_KEY) return send(chatId, 'Chua set OPENROUTER_API_KEY.');
  if (!arg) return send(chatId, 'Cu phap: <code>/ask url video</code>\nHo tro: YouTube, TikTok, Facebook, BiliBili');
  let videoInfo = null;
  try {
    const r = await resolverFetch('/resolve', { url: arg });
    if (r.ok && r.resolved) videoInfo = r.resolved;
  } catch {}
  const context = buildMatchContext(readMatches);
  const prompt = videoInfo
    ? `Video: ${videoInfo.title}\nURL: ${videoInfo.videoUrl}\nAuthor: ${videoInfo.author || '?'}\n\nDu lieu bong da hien co:\n${context}`
    : `URL: ${arg}\nResolve that bai. Du lieu bong da hien co:\n${context}`;
  const reply = await aiChat([
    { role: 'system', content: 'Ban la tro ly bong da. Phan tich video/tin hoi va lien he den bong da. Tra loi bang tieng Viet, ngan gon.' },
    { role: 'user', content: prompt },
  ]);
  return send(chatId, `🤖 <b>AI phan tich:</b>\n${esc(reply)}`);
}

// ── formatMatches (export cho test + dùng chung) ────────────────

export function formatMatches(matches, q, limit = 8) {
  const needle = String(q || '').trim().toLowerCase();
  const rows = matches
    .filter((m) => !needle || `${m.home} ${m.away} ${m.league}`.toLowerCase().includes(needle))
    .sort((a, b) => new Date(a.kickoffISO) - new Date(b.kickoffISO))
    .slice(0, limit);
  if (!rows.length) return 'Không có trận nào' + (needle ? ` cho "${q}"` : '') + '.';
  return formatRows(rows, '');
}

// ── main export ──────────────────────────────────────────────────

export function startTelegram({ token, allowedChats = [], readMatches, onCrawl }) {
  if (!token) {
    console.log('Telegram: chưa có TELEGRAM_BOT_TOKEN, bỏ qua bot.');
    return null;
  }

  let offset = 0;
  let stopped = false;

  const api = (method, body) =>
    fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json());

  const send = (chatId, text) =>
    api('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }).catch(() => {});

  const allowed = (id) => !allowedChats.length || allowedChats.includes(String(id));

  async function handle(msg) {
    const chatId = msg.chat.id;
    if (!allowed(chatId)) return;
    const parsed = parseCommand(msg.text);
    if (!parsed) return;

    switch (parsed.cmd) {
      case 'help':     return handleHelp(chatId, send);
      case 'live':     return handleLive(chatId, send, readMatches);
      case 'tomorrow': return handleTomorrow(chatId, send, readMatches);
      case 'next':     return handleNext(chatId, send, readMatches, parsed.arg);
      case 'stats':    return handleStats(chatId, send, readMatches);
      case 'web':      return handleWeb(chatId, send, readMatches);
      case 'fav':      return handleFav(chatId, send, parsed.arg, readMatches);
      case 'favs':     return handleFavs(chatId, send);
      case 'crawl':    return handleCrawl(chatId, send, onCrawl);
      case 'cancel':   return send(chatId, '🛑 Đã gửi tín hiệu huỷ crawl.');
      case 'resolve':  return handleResolve(chatId, send, parsed.arg);
      case 'debug':    return handleDebug(chatId, send, parsed.arg);
      case 'ai':       return handleAI(chatId, send, parsed.arg, readMatches);
      case 'ask':      return handleAsk(chatId, send, parsed.arg, readMatches);
      default:         return send(chatId, 'Lệnh lạ. Gõ /help để xem danh sách.');
    }
  }

  (async function loop() {
    console.log('Telegram bot: polling...');
    while (!stopped) {
      try {
        const data = await api('getUpdates', { offset, timeout: 30 });
        for (const u of (data && data.result) || []) {
          offset = u.update_id + 1;
          if (u.message) await handle(u.message).catch(() => {});
        }
      } catch {
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  })();

  return { stop() { stopped = true; } };
}
