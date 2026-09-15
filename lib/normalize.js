export function normalizeTeam(s) {
  // Bỏ dấu câu để "1. FSV Mainz 05" và "1-fsv-mainz-05" (từ slug URL) trùng nhau.
  return String(s ?? '').trim().toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ');
}

export function hourBucket(kickoffISO) {
  const s = String(kickoffISO ?? '');
  // Group by hour in the original ISO string: YYYY-MM-DDTHH
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2})/);
  if (m) return `${m[1]}T${m[2]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}`;
  }
  return s.slice(0, 13);
}

export function matchKey(m) {
  return `${normalizeTeam(m.home)}|${normalizeTeam(m.away)}|${hourBucket(m.kickoffISO)}`;
}

// Gộp theo trận (đội + ngày, bỏ qua giờ): cùng 1 cặp đấu trong ngày
// dù khác nguồn/giờ (vd Gavang slug chỉ có ngày, Socolive có giờ thật)
// cũng thành 1 dòng, gom hết link. Ưu tiên giữ giờ đá cụ thể (khác 00:00).
export function groupKey(m) {
  const d = String(m.kickoffISO ?? '').slice(0, 10);
  return `${normalizeTeam(m.home)}|${normalizeTeam(m.away)}|${d}`;
}

function hasRealTime(iso) {
  return /T(?!00:00:00)[0-9]{2}:[0-9]{2}/.test(String(iso ?? ''));
}

export function groupMatches(matches) {
  const map = new Map();
  for (const m of matches) {
    const key = groupKey(m);
    if (!map.has(key)) {
      map.set(key, { ...m, links: [...(m.links ?? [])] });
      continue;
    }
    const cur = map.get(key);
    if (hasRealTime(m.kickoffISO) && !hasRealTime(cur.kickoffISO)) {
      cur.kickoffISO = m.kickoffISO;
    }
    if ((cur.league === 'Tong hop' || !cur.league) && m.league && m.league !== 'Tong hop') {
      cur.league = m.league;
    }
    cur.isLive = cur.isLive || m.isLive;
    if (!cur.blv && m.blv) cur.blv = m.blv;
    const seen = new Set(cur.links.map((l) => l.url));
    for (const l of m.links ?? []) {
      if (!seen.has(l.url)) {
        cur.links.push(l);
        seen.add(l.url);
      }
    }
  }
  return [...map.values()];
}

export function dedupeMatches(matches) {
  const map = new Map();
  for (const m of matches) {
    const key = matchKey(m);
    if (!map.has(key)) {
      map.set(key, { ...m, links: [...(m.links ?? [])] });
    } else {
      const cur = map.get(key);
      const seen = new Set(cur.links.map((l) => l.url));
      for (const l of m.links ?? []) {
        if (!seen.has(l.url)) {
          cur.links.push(l);
          seen.add(l.url);
        }
      }
    }
  }
  return [...map.values()];
}

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

// ── BLV parsers (dùng chung cho Puppeteer DOM lẫn HTML từ Firecrawl) ──

// "BLV Link Trực Tiếp A vs B vào lúc HH:MM DD/MM[/YYYY]" -> {home, away, iso}
export function parseBlvAria(label) {
  const m = String(label || '').match(/Trực Tiếp\s+(.+?)\s+vs\s+(.+?)\s+vào lúc\s+(\d{1,2}:\d{2})\s+(\d{1,2}\/\d{1,2}(?:\/\d{4})?)/i);
  if (!m) return null;
  const tp = m[4].split('/');
  const iso = `${tp[2] || new Date().getFullYear()}-${String(tp[1]).padStart(2, '0')}-${String(tp[0]).padStart(2, '0')}T${m[3]}:00+07:00`;
  return { home: m[1].trim(), away: m[2].trim(), iso };
}

// Tên BLV lẫn với chữ trang trí ("BLV đông nhưng chất"...): lọc theo blocklist.
export const BLV_JUNK = /trực tiếp|truc tiep|^xem|live|chất|chat|đông|dong|hd|full|miễn phí|mien phi|bóng đá|bong da|tốc độ|toc do|socolive|xoilac|gavang|bình luận|binh luan|việt|viet/i;
export function pickBlvName(cands) {
  for (let c of cands) {
    c = String(c || '').replace(/^BLV\s+/i, '').trim().replace(/\s+/g, ' ');
    if (c.length < 2 || c.length > 24) continue;
    if (BLV_JUNK.test(c)) continue;
    if ((c.match(/\d/g) || []).length > 4) continue;
    return c;
  }
  return '';
}

// Gom items {label(aria), texts[], imgs[], url} thành matches (giống crawlBlvCards).
export function buildBlvGroups(items, srcId, srcName) {
  const groups = new Map();
  const addLink = (home, away, iso, url, blvName) => {
    const key = `${home.trim().toLowerCase()}|${away.trim().toLowerCase()}|${iso}`;
    if (!groups.has(key)) {
      groups.set(key, {
        home: home.trim(), away: away.trim(), league: 'Tong hop',
        kickoffISO: iso, isLive: false, source: srcId, links: []
      });
    }
    const g = groups.get(key);
    if (!g.links.some((l) => l.url === url)) {
      g.links.push({ label: blvName ? `BLV ${blvName}` : srcName, url });
      if (blvName && !g.blv) g.blv = blvName;
    }
  };
  for (const it of items) {
    const p = parseBlvAria(it.label);
    if (!p) continue;
    addLink(p.home, p.away, p.iso, it.url, pickBlvName([...(it.texts || []), ...(it.imgs || [])]));
  }
  return [...groups.values()];
}

// JSON-LD BroadcastEvent/SportsEvent -> matches (dùng cho cả HTML tĩnh).
export function eventsFromJsonLd(json) {
  const out = [];
  const push = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(push); return; }
    if (obj['@graph']) { push(obj['@graph']); return; }
    const type = String(obj['@type'] || '');
    const teams = obj.performer || obj.competitor || [];
    const names = (Array.isArray(teams) ? teams : [teams])
      .map((t) => t && t.name).filter(Boolean);
    if ((type === 'BroadcastEvent' || type === 'SportsEvent') && names.length >= 2 && obj.startDate) {
      out.push({
        home: String(names[0]).trim(),
        away: String(names[1]).trim(),
        league: (obj.partOfSeries && obj.partOfSeries.name) || 'Tong hop',
        kickoffISO: obj.startDate,
        isLive: obj.isLiveBroadcast === true || /live/i.test(obj.eventStatus || ''),
      });
    }
  };
  push(json);
  return out;
}
