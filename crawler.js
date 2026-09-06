// crawler.js
import fs from 'node:fs';
import puppeteer from 'puppeteer';
import { SOURCES } from './sources.js';
import { dedupeMatches, groupMatches } from './lib/normalize.js';

function eventsFromJsonLd(json) {
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

async function crawlJsonLd(page, src) {
  const blobs = await page.$$eval('script[type="application/ld+json"]', (els) =>
    els.map((s) => s.textContent || '').filter(Boolean)
  );
  const found = [];
  for (const b of blobs) {
    try { found.push(...eventsFromJsonLd(JSON.parse(b))); } catch { /* skip block lỗi */ }
  }
  const pageUrl = page.url();
  return found.map((m) => ({ ...m, source: src.id, links: [{ label: src.name, url: pageUrl }] }));
}

// Trang phù hợp = trang lịch có tên BLV (mỗi trận gán BLV cụ thể),
// chứ không phải trang SEO rỗng. Dùng làm tiêu chí chọn trang.
async function extractBlv(page) {
  const text = await page.evaluate(() => (document.body ? document.body.innerText : '').slice(0, 60000));
  const names = new Set();
  const re = /BLV\s+([A-ZÀ-Ỹa-zà-ỹ0-9.'-]{2,}(?:\s+[A-ZÀ-Ỹa-zà-ỹ0-9.'-]{1,20}){0,2})/g;
  let m;
  while ((m = re.exec(text)) && names.size < 30) {
    const n = m[1].trim().replace(/\s+/g, ' ');
    if (n.length >= 2 && n.length <= 30) names.add(n);
  }
  return [...names];
}

// Template kiểu socoliveo.tv: mỗi trận có nhiều link, mỗi link gắn 1 BLV.
// <a class="dropdown-item" href=".../truc-tiep/<home>-vs-<away>-<date>/?blv=..."
//    aria-label="BLV Link Trực Tiếp <home> vs <away> vào lúc <HH:MM> <DD/MM[/YYYY]>">
async function crawlBlvCards(page, src) {
  const items = await page.$$eval('a.dropdown-item[href*="/truc-tiep/"]', (els) =>
    els.map((a) => ({
      label: a.getAttribute('aria-label') || '',
      blv: ((a.querySelector('span') || {}).textContent || (a.querySelector('img') || {}).alt || '').trim(),
      url: a.href
    }))
  );
  const groups = new Map();
  const addLink = (home, away, iso, url, blvName) => {
    const key = `${home.trim().toLowerCase()}|${away.trim().toLowerCase()}|${iso}`;
    if (!groups.has(key)) {
      groups.set(key, {
        home: home.trim(), away: away.trim(), league: 'Tong hop',
        kickoffISO: iso, isLive: false, source: src.id, links: []
      });
    }
    const g = groups.get(key);
    if (!g.links.some((l) => l.url === url)) {
      g.links.push({ label: blvName ? `BLV ${blvName}` : src.name, url });
      if (blvName && !g.blv) g.blv = blvName;
    }
  };
  for (const it of items) {
    const m = it.label.match(/Trực Tiếp\s+(.+?)\s+vs\s+(.+?)\s+vào lúc\s+(\d{1,2}:\d{2})\s+(\d{1,2}\/\d{1,2}(?:\/\d{4})?)/i);
    if (!m) continue;
    const timeParts = m[4].split('/');
    const iso = `${timeParts[2] || new Date().getFullYear()}-${String(timeParts[1]).padStart(2, '0')}-${String(timeParts[0]).padStart(2, '0')}T${m[3]}:00+07:00`;
    const blvName = (it.blv || '').replace(/^BLV\s+/i, '').trim();
    addLink(m[1], m[2], iso, it.url, blvName);
  }
  if (!groups.size) {
    // Template kiểu gavang: link overlay rỗng, mọi thông tin nằm trong slug
    // /truc-tiep/<home>-vs-<away>-ngay-<DD>-<MM>-<YYYY>/ (không có giờ).
    const hrefs = await page.$$eval('a[href*="/truc-tiep/"]', (els) => els.map((a) => a.href));
    for (const href of hrefs) {
      const m = href.match(/\/truc-tiep\/(.+?)-vs-(.+?)-ngay-(\d{2})-(\d{2})-(\d{4})\/?(?:[?#]|$)/i);
      if (!m) continue;
      const iso = `${m[5]}-${m[4]}-${m[3]}T00:00:00+07:00`;
      addLink(m[1].replace(/-/g, ' '), m[2].replace(/-/g, ' '), iso, href, '');
    }
  }
  return [...groups.values()];
}

// Lọc host ứng viên từ kết quả tìm kiếm: giữ domain chứa từ khóa
// (socolive/gavang/xoilac...), loại big-tech/mạng xã hội, khử trùng.
export function filterCandidateHosts(hosts, keyword) {
  const kw = String(keyword || '').toLowerCase();
  const blocked = /google|youtube|facebook|wikipedia|tiktok|twitter|instagram|reddit|bing\.com|duckduckgo|amazon|shopee|lazada/i;
  const seen = new Set();
  const out = [];
  for (let h of hosts) {
    h = String(h || '').toLowerCase().trim().replace(/^www\./, '');
    if (!h || seen.has(h)) continue;
    seen.add(h);
    if (!h.includes(kw)) continue;
    if (blocked.test(h)) continue;
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) continue;
    out.push(h);
    if (out.length >= 8) break;
  }
  return out;
}

function loadDiscovered() {
  try { return JSON.parse(fs.readFileSync('discovered.json', 'utf8')); }
  catch { return {}; }
}

function saveDiscovered(map) {
  try { fs.writeFileSync('discovered.json', JSON.stringify(map, null, 2)); } catch {}
}

// Lấy hostname từ 1 kết quả Bing: ưu tiên thẻ cite (domain hiển thị),
/// fallback giải mã tham số u= (base64url của URL thật trong link redirect /ck/a).
export function hostFromBingResult(href, cite) {
  const c = String(cite || '').replace(/^https?:\/\//i, '').split(/[\s›/]+/).filter(Boolean)[0] || '';
  const cleaned = c.replace(/^www\./i, '');
  if (cleaned.includes('.') && !cleaned.includes(' ')) return cleaned.toLowerCase();
  try {
    const u = new URL(href);
    const b64 = u.searchParams.get('u');
    if (b64) {
      const norm = b64.replace(/^a\d+/, '').replace(/-/g, '+').replace(/_/g, '/');
      return new URL(Buffer.from(norm, 'base64').toString('utf8')).hostname.toLowerCase();
    }
    return u.hostname.toLowerCase();
  } catch { return ''; }
}
// Tự tìm domain mới qua Bing (DuckDuckGo/Mojeek đều chặn bot headless).
// Chỉ gọi khi toàn bộ URL cứng đều chết, để crawl thường không bị chậm.
async function discoverDomains(browser, src) {
  if (!src.discovery) return [];
  const page = await browser.newPage();
  try {
    const q = encodeURIComponent(src.discovery.query);
    await page.goto(`https://www.bing.com/search?q=${q}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const rows = await page.$$eval('li.b_algo', (els) =>
      els.slice(0, 12).map((li) => ({
        href: (li.querySelector('h2 a') || {}).href || '',
        cite: (li.querySelector('cite') || {}).textContent?.trim() || ''
      }))
    );
    const hosts = rows.map((r) => hostFromBingResult(r.href, r.cite));
    const cands = filterCandidateHosts(hosts, src.discovery.keyword);
    console.log(`Discovery ${src.id}: tim thay ${cands.length} domain (${cands.join(', ') || 'khong co'})`);
    return cands.map((h) => `https://${h}/`);
  } catch (e) {
    console.warn(`WARN discovery ${src.id} loi: ${e.message}`);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

async function tryParseUrl(browser, src, url) {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const blv = await extractBlv(page).catch(() => []);
    const tag = blv.length >= 3 ? `trang phù hợp (${blv.length} BLV)` : 'không thấy BLV (có thể là trang SEO)';
    // Thử lần lượt: card BLV (trang phù hợp) -> JSON-LD -> anchor chung.
    // Mỗi URL fallback có thể là template khác nhau nên thử hết.
    const viaBlv = await crawlBlvCards(page, src).catch(() => []);
    if (viaBlv.length) {
      console.log(`OK source ${src.id}: ${url} — trang phù hợp (${viaBlv.length} trận, có tên BLV)`);
      await page.close().catch(() => {});
      return viaBlv;
    }
    {
      const viaJson = await crawlJsonLd(page, src);
      if (viaJson.length) {
        console.log(`OK source ${src.id}: ${url} — ${tag}`);
        await page.close().catch(() => {});
        return viaJson;
      }
    }
    const items = await page.$$eval(src.linkSelector, (els) =>
      els.slice(0, 60).map((a) => ({
        text: (a.textContent || '').trim().replace(/\s+/g, ' '),
        url: a.href
      }))
    );
    const rows = items
      .filter((x) => /vs/i.test(x.text) && x.text.length < 120)
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
    await page.close().catch(() => {});
    if (rows.length) {
      console.log(`OK source ${src.id}: ${url} — ${tag}`);
      return rows;
    }
    console.warn(`WARN source ${src.id}: ${url} khong thay tran (${tag}), thu tiep`);
    return [];
  } catch (e) {
    console.warn(`WARN source ${src.id} loi (${url}): ${e.message}`);
    await page.close().catch(() => {});
    return [];
  }
}

async function crawlSource(browser, src, discovered) {
  const urls = [src.scheduleUrl, ...((discovered && discovered[src.id]) || []), ...(src.fallbacks || [])];
  for (const url of urls) {
    const rows = await tryParseUrl(browser, src, url);
    if (rows.length) {
      if (discovered) { discovered[src.id] = [url, ...((discovered[src.id]) || []).filter((u) => u !== url)].slice(0, 3); }
      return rows;
    }
  }
  // Toàn bộ URL cứng chết -> tự tìm domain mới, thử và lưu lại cho lần sau.
  const cands = await discoverDomains(browser, src);
  for (const url of cands) {
    if (urls.includes(url)) continue;
    const rows = await tryParseUrl(browser, src, url);
    if (rows.length) {
      if (discovered) { discovered[src.id] = [url, ...((discovered[src.id]) || [])].slice(0, 3); }
      return rows;
    }
  }
  return [];
}

// Chạy toàn bộ quy trình crawl, trả về {count}. Dùng chung cho CLI và nút web.
export async function runCrawl() {
  // Container (Render/Docker) chạy root nên cần --no-sandbox.
  // PUPPETEER_EXECUTABLE_PATH để trỏ sang Chromium cài bằng apt.
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const discovered = loadDiscovered();
  let all = [];
  for (const src of SOURCES) {
    const r = await crawlSource(browser, src, discovered);
    console.log(`${src.id}: ${r.length} tran`);
    all.push(...r);
  }
  await browser.close();
  saveDiscovered(discovered);

  const manual = JSON.parse(fs.readFileSync('manual-links.json', 'utf8'));
  const prev = JSON.parse(fs.readFileSync('matches.json', 'utf8'));
  const merged = groupMatches(dedupeMatches([...all, ...manual, ...prev]));
  fs.writeFileSync('matches.json', JSON.stringify(merged.slice(0, 100), null, 2));
  const count = Math.min(merged.length, 100);
  console.log(`OK ghi ${count} tran vao matches.json`);
  return { count };
}

// Chỉ chạy crawl khi gọi trực tiếp (node crawler.js), để test import được helper.
if ((process.argv[1] || '').replace(/\\/g, '/').endsWith('crawler.js')) {
  await runCrawl();
}
