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
