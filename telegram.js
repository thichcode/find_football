// telegram.js — bot Telegram dùng fetch có sẵn của Node 22, không thêm dependency.
// Lệnh: /start /crawl /matches [/find <tên đội>]
// Env: TELEGRAM_BOT_TOKEN (bắt buộc), ALLOWED_CHAT_IDS (tùy chọn, cách nhau bằng dấu phẩy).
export function parseCommand(text) {
  const t = String(text || '').trim();
  if (!t.startsWith('/')) return null;
  const [cmd, ...rest] = t.slice(1).split(/\s+/);
  return { cmd: cmd.toLowerCase().split('@')[0], arg: rest.join(' ').trim() };
}

export function formatMatches(matches, q, limit = 8) {
  const needle = String(q || '').trim().toLowerCase();
  const rows = matches
    .filter((m) => !needle || `${m.home} ${m.away} ${m.league}`.toLowerCase().includes(needle))
    .sort((a, b) => new Date(a.kickoffISO) - new Date(b.kickoffISO))
    .slice(0, limit);
  if (!rows.length) return 'Không có trận nào' + (needle ? ` cho "${q}"` : '') + '.';
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let out = '';
  for (const m of rows) {
    const time = (() => { const d = new Date(m.kickoffISO); return Number.isNaN(d) ? '' : d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }); })();
    let chunk = `⚽ <b>${esc(m.home)} vs ${esc(m.away)}</b> (${time})\n`;
    for (const l of (m.links || []).slice(0, 6)) chunk += `- <a href="${esc(l.url)}">${esc(l.label)}</a>\n`;
    if (out.length + chunk.length > 3500) break;
    out += chunk + '\n';
  }
  return out.trim();
}

export function startTelegram({ token, allowedChats = [], readMatches, onCrawl }) {
  if (!token) {
    console.log('Telegram: chưa có TELEGRAM_BOT_TOKEN, bỏ qua bot.');
    return null;
  }
  let offset = 0;
  let stopped = false;
  const api = (method, body) =>
    fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then((r) => r.json());
  const send = (chatId, text) =>
    api('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }).catch(() => {});
  const allowed = (id) => !allowedChats.length || allowedChats.includes(String(id));

  async function handle(msg) {
    const chatId = msg.chat.id;
    if (!allowed(chatId)) {
      await send(chatId, 'Bot này chỉ phục vụ chủ sở hữu.');
      return;
    }
    const parsed = parseCommand(msg.text);
    if (!parsed) return;
    if (parsed.cmd === 'start') {
      await send(chatId, 'FindFootball bot.\n/crawl — crawl lịch + link mới\n/matches — trận sắp tới\n/find &lt;tên đội&gt; — tìm trận');
      return;
    }
    if (parsed.cmd === 'crawl') {
      await send(chatId, '⏳ Đang crawl, đợi 1-2 phút...');
      try {
        const r = await onCrawl();
        await send(chatId, `✅ Crawl xong: ${r.count} trận. Gõ /matches để xem.`);
      } catch (e) {
        await send(chatId, '❌ Crawl lỗi: ' + String((e && e.message) || e).slice(0, 200));
      }
      return;
    }
    if (parsed.cmd === 'matches' || parsed.cmd === 'find') {
      const matches = readMatches();
      const now = Date.now();
      const upcoming = matches.filter((m) => {
        const t = new Date(m.kickoffISO).getTime();
        return Number.isNaN(t) || t + 120 * 60 * 1000 >= now;
      });
      await send(chatId, formatMatches(upcoming, parsed.cmd === 'find' ? parsed.arg : ''));
      return;
    }
    await send(chatId, 'Lệnh lạ. Thử /start');
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
