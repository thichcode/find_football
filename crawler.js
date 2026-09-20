// crawler.js
import fs from 'node:fs';
import puppeteer from 'puppeteer';
import { SOURCES } from './sources.js';
import { dedupeMatches, groupMatches, buildBlvGroups, eventsFromJsonLd } from './lib/normalize.js';
import { scrapeHtml, parseBlvCardsFromHtml, parseJsonLdFromHtml, parseGoogleHosts } from './lib/firecrawl.js';

// URL playlist stream (HLS/DASH) — dùng chung cho probe lẫn auto-sniff.
const STREAM_RE = /\.(m3u8|mpd)(\?|#|$)/i;
export function isStreamUrl(u) {
  return STREAM_RE.test(String(u || ''));
}

// Mở trang trận đấu, hứng request playlist đầu tiên (.m3u8/.mpd).
// Trả về URL stream hoặc null. Chạy browser riêng, tự đóng.
export async function sniffStreamUrl(pageUrl, timeoutMs = 25000) {
  if (!/^https?:/i.test(String(pageUrl || ''))) return null;
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    protocolTimeout: 60000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36').catch(() => {});
    await page.setViewport({ width: 1366, height: 768 }).catch(() => {});
    let found = null;
    const grab = (u) => { if (!found && isStreamUrl(u)) found = u; };
    page.on('request', (req) => grab(req.url()));
    page.on('response', (res) => grab(res.url()));
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    const t0 = Date.now();
    while (!found && Date.now() - t0 < timeoutMs) {
      // Kích player tự chạy (nhiều trang chỉ load stream sau khi play).
      await page.evaluate(() => {
        document.querySelectorAll('video').forEach((v) => { v.muted = true; v.play().catch(() => {}); });
      }).catch(() => {});
      await new Promise((r) => setTimeout(r, 2000));
    }
    return found;
  } finally {
    await browser.close().catch(() => {});
  }
}

// Log từng URL đã thử trong 1 lần crawl (để /api/crawl trả debug về client).
// tryParseUrl push vào đây, runCrawl đọc + xóa.
const attemptLog = [];
function logAttempt(source, url, strategy, rows, note = '') {
  const links = (rows || []).flatMap((m) => m.links || []).map((l) => l.url);
  attemptLog.push({
    source, url, strategy,
    count: (rows || []).length,
    sample: [...new Set(links)].slice(0, 3),
    note: String(note || '').slice(0, 600),
  });
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
// Template xoilacd.tv tương tự nhưng tên BLV nằm rải rác trong span/img,
// lẫn với chữ trang trí ("BLV đông nhưng chất"...): lọc theo blocklist (xem normalize.js).
async function crawlBlvCards(page, src) {
  const items = await page.$$eval('a.dropdown-item[href*="/truc-tiep/"]', (els) =>
    els.map((a) => ({
      label: a.getAttribute('aria-label') || '',
      texts: [...a.querySelectorAll('span')].map((s) => (s.textContent || '').trim()).filter(Boolean),
      imgs: [...a.querySelectorAll('img')].map((i) => (i.alt || '').trim()).filter(Boolean),
      url: a.href
    }))
  );
  const groups = buildBlvGroups(items, src.id, src.name);
  const groupMap = new Map(groups.map((g) => [`${g.home}|${g.away}|${g.kickoffISO}`, g]));
  const addLink = (home, away, iso, url, blvName) => {
    const key = `${home.trim().toLowerCase()}|${away.trim().toLowerCase()}|${iso}`;
    if (!groupMap.has(key)) {
      const g = {
        home: home.trim(), away: away.trim(), league: 'Tong hop',
        kickoffISO: iso, isLive: false, source: src.id, links: []
      };
      groups.push(g);
      groupMap.set(key, g);
    }
    const g = groupMap.get(key);
    if (!g.links.some((l) => l.url === url)) {
      g.links.push({ label: blvName ? `BLV ${blvName}` : src.name, url });
      if (blvName && !g.blv) g.blv = blvName;
    }
  };
  if (!groups.length) {
    // Template kiểu gavang: link overlay rỗng, mọi thông tin nằm trong slug
    // /truc-tiep/<home>-vs-<away>-ngay-<DD>-<MM>-<YYYY>/ (không có giờ).
    const hrefs = await page.$$eval('a[href*="/truc-tiep/"]', (els) => els.map((a) => a.href));
    // Fallback: lấy BLV từ text trang nếu có, gán ngẫu nhiên cho link.
    const blvs = await extractBlv(page);
    const blvPool = blvs.length ? blvs : [];
    let blvIdx = 0;
    for (const href of hrefs) {
      const m = href.match(/\/truc-tiep\/(.+?)-vs-(.+?)-ngay-(\d{2})-(\d{2})-(\d{4})\/?(?:[?#]|$)/i);
      if (!m) continue;
      const iso = `${m[5]}-${m[4]}-${m[3]}T00:00:00+07:00`;
      const blvName = blvPool[blvIdx % blvPool.length] || '';
      blvIdx++;
      addLink(m[1].replace(/-/g, ' '), m[2].replace(/-/g, ' '), iso, href, blvName);
    }
  }
  return groups;
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
// Google qua Firecrawl (vượt chặn bot): trả về URL theo đúng thứ tự Google xếp.
// Không cần browser. Trả [] nếu không có key Firecrawl hoặc lỗi.
async function discoverGoogle(src) {
  if (!src.discovery) return [];
  try {
    const html = await scrapeHtml(`https://www.google.com/search?q=${encodeURIComponent(src.discovery.query)}&num=10`);
    if (!html) return [];
    const g = parseGoogleHosts(html, src.discovery.keyword);
    console.log(`Discovery ${src.id} (google): ${g.join(', ') || 'khong co'}`);
    return g.map((h) => `https://${h}/`);
  } catch (e) {
    console.warn(`WARN discovery ${src.id} google loi: ${e.message}`);
    return [];
  }
}
// Bing trực tiếp (không cần key): dự phòng khi Google/Firecrawl lỗi.
async function discoverBing(browser, src) {
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
    console.log(`Discovery ${src.id} (bing): tim thay ${cands.length} domain (${cands.join(', ') || 'khong co'})`);
    return cands.map((h) => `https://${h}/`);
  } catch (e) {
    console.warn(`WARN discovery ${src.id} bing loi: ${e.message}`);
    return [];
  } finally {
    await page.close().catch(() => {});
  }
}

async function tryParseUrl(browser, src, url) {
  const page = await browser.newPage();
  try {
    // UA thật + viewport desktop: giảm tỉ lệ dính challenge Cloudflare.
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36').catch(() => {});
    await page.setViewport({ width: 1366, height: 768 }).catch(() => {});
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    // Site tự redirect bằng JS (vd socoliveo -> socoliven): đợi rồi bám theo URL cuối.
    await new Promise((r) => setTimeout(r, 2500));
    if (page.url() !== url) {
      await page.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1500));
    }
    // Challenge Cloudflare ("Just a moment..."): đợi tối đa ~20s cho nó tự qua.
    for (let i = 0; i < 10; i++) {
      const t = await page.title().catch(() => '');
      if (!/just a moment|attention required|security challenge/i.test(t)) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    const finalUrl = page.url();
    // Chẩn đoán template ngay khi frame còn tươi (trước khi parse có thể redirect tiếp).
    const diag = await page.evaluate(() => {
      try {
        const tt = [...document.querySelectorAll('a[href*="truc-tiep"]')];
        const dd = document.querySelectorAll('a.dropdown-item').length;
        const aria = [...document.querySelectorAll('a[aria-label*="Tr"]')].slice(0, 2)
          .map((a) => (a.getAttribute('aria-label') || '').slice(0, 80));
        return JSON.stringify({
          title: document.title.slice(0, 60),
          finalUrl: location.href.slice(0, 100),
          trucTiep: tt.length,
          dropdownItem: dd,
          sample: tt.slice(0, 4).map((a) => a.href.slice(0, 120)),
          aria,
        });
      } catch (e) { return 'diag-fail:' + e.message; }
    }).catch((e) => 'diag-fail:' + e.message);
    const blv = await extractBlv(page).catch(() => []);
    const tag = blv.length >= 3 ? `trang phù hợp (${blv.length} BLV)` : 'không thấy BLV (có thể là trang SEO)';
    // Thử lần lượt: card BLV (trang phù hợp) -> JSON-LD -> anchor chung.
    // Mỗi URL fallback có thể là template khác nhau nên thử hết.
    const viaBlv = await crawlBlvCards(page, src).catch(() => []);
    if (viaBlv.length) {
      console.log(`OK source ${src.id}: ${url} — trang phù hợp (${viaBlv.length} trận, có tên BLV)`);
      await page.close().catch(() => {});
      logAttempt(src.id, url, 'blv-cards', viaBlv);
      return viaBlv;
    }
    {
      const viaJson = await crawlJsonLd(page, src);
      if (viaJson.length) {
        console.log(`OK source ${src.id}: ${url} — ${tag}`);
        await page.close().catch(() => {});
        logAttempt(src.id, url, 'jsonld', viaJson, tag);
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
      logAttempt(src.id, url, 'anchors', rows, tag);
      return rows;
    }
    console.warn(`WARN source ${src.id}: ${url} khong thay tran (${tag}), thu tiep`);
    logAttempt(src.id, url, 'empty', [], tag + ' | final=' + finalUrl.slice(0, 100) + ' | ' + diag);
    // Puppeteer trắng tay (challenge/timeout) -> thử Firecrawl Cloud nếu có key.
    const viaFire = await tryFirecrawl(src, url, finalUrl);
    if (viaFire.length) return viaFire;
    return [];
  } catch (e) {
    console.warn(`WARN source ${src.id} loi (${url}): ${e.message}`);
    await page.close().catch(() => {});
    logAttempt(src.id, url, 'error', [], e.message);
    // Lỗi navigation cũng thử Firecrawl.
    const viaFire = await tryFirecrawl(src, url, url);
    if (viaFire.length) return viaFire;
    return [];
  }
}

// Fallback cuối: lấy HTML qua Firecrawl Cloud API (vượt challenge),
// parse bằng cùng parser BLV/JSON-LD. Trả [] nếu không có key hoặc thất bại.
async function tryFirecrawl(src, url, pageUrl) {
  if (!process.env.FIRECRAWL_API_KEY) return [];
  try {
    const html = await scrapeHtml(url);
    if (!html) {
      logAttempt(src.id, url, 'firecrawl-error', [], 'API tra ve rong');
      return [];
    }
    const viaBlv = parseBlvCardsFromHtml(html, pageUrl, src);
    if (viaBlv.length) {
      console.log(`OK source ${src.id}: ${url} — firecrawl (${viaBlv.length} trận, có tên BLV)`);
      logAttempt(src.id, url, 'firecrawl', viaBlv);
      return viaBlv;
    }
    const viaJson = parseJsonLdFromHtml(html, pageUrl, src);
    if (viaJson.length) {
      console.log(`OK source ${src.id}: ${url} — firecrawl jsonld (${viaJson.length} trận)`);
      logAttempt(src.id, url, 'firecrawl-jsonld', viaJson);
      return viaJson;
    }
    logAttempt(src.id, url, 'firecrawl-empty', [], `html ${html.length} chars, khong parse duoc tran`);
    return [];
  } catch (e) {
    logAttempt(src.id, url, 'firecrawl-error', [], String((e && e.message) || e));
    return [];
  }
}

async function crawlSource(browser, src, discovered) {
  // Domain nhảy liên tục: Google (kết quả mới nhất, đúng hành vi người dùng) đi TRƯỚC,
  // URL cứng + discovered làm dự phòng. Dừng ở URL đầu tiên ra trận.
  const googleUrls = await discoverGoogle(src);
  const hardUrls = [src.scheduleUrl, ...((discovered && discovered[src.id]) || []), ...(src.fallbacks || [])];
  const urls = [...googleUrls, ...hardUrls.filter((u) => !googleUrls.includes(u))];
  for (const url of urls) {
    const rows = await tryParseUrl(browser, src, url);
    if (rows.length) {
      if (discovered) { discovered[src.id] = [url, ...((discovered[src.id]) || []).filter((u) => u !== url)].slice(0, 3); }
      return rows;
    }
  }
  // Toàn bộ trên chết -> Bing dự phòng, thử và lưu lại cho lần sau.
  const cands = await discoverBing(browser, src);
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

// Chạy toàn bộ quy trình crawl, trả về {count, debug}. Dùng chung cho CLI và nút web.
export async function runCrawl() {
  // Container (Render/Docker) chạy root nên cần --no-sandbox.
  // PUPPETEER_EXECUTABLE_PATH để trỏ sang Chromium cài bằng apt.
  attemptLog.length = 0;
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    protocolTimeout: 60000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
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

  // Gom debug theo nguồn: url nào thắng + toàn bộ attempt.
  const debug = SOURCES.map((src) => {
    const tries = attemptLog.filter((a) => a.source === src.id);
    const won = tries.find((a) => a.count > 0);
    return { source: src.id, usedUrl: won ? won.url : null, strategy: won ? won.strategy : null, attempts: tries };
  });

  const manual = JSON.parse(fs.readFileSync('manual-links.json', 'utf8'));
  const prev = JSON.parse(fs.readFileSync('matches.json', 'utf8'));
  const merged = groupMatches(dedupeMatches([...all, ...manual, ...prev]));
  // Tính lại cờ LIVE từ giờ đá (không kế thừa flag cũ đã hết hạn):
  // live = đã đá mà chưa quá 120 phút.
  const now = Date.now();
  for (const m of merged) {
    const t = new Date(m.kickoffISO).getTime();
    m.isLive = !Number.isNaN(t) && t <= now && now - t < 120 * 60 * 1000;
  }
  fs.writeFileSync('matches.json', JSON.stringify(merged.slice(0, 100), null, 2));
  const count = Math.min(merged.length, 100);
  console.log(`OK ghi ${count} tran vao matches.json`);
  // Push len GitHub de giu data khi Render restart
  await commitToGitHub('matches.json').catch((e) => console.log('GitHub push skip:', e.message));
  return { count, debug };
}

// Push file len GitHub (can GITHUB_TOKEN env var, scope repo)
export async function commitToGitHub(filePath) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return;
  const owner = 'thichcode', repo = 'find_football';
  const api = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;
  const content = fs.readFileSync(filePath, 'utf8');
  const encoded = Buffer.from(content).toString('base64');
  let sha = '';
  try {
    const r = await fetch(api, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' } });
    if (r.ok) { const d = await r.json(); sha = d.sha || ''; }
  } catch {}
  const body = { message: `sync: ${filePath} ${new Date().toISOString()}`, content: encoded };
  if (sha) body.sha = sha;
  const res = await fetch(api, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('GitHub ' + res.status);
}

// Chỉ chạy crawl khi gọi trực tiếp (node crawler.js), để test import được helper.
if ((process.argv[1] || '').replace(/\\/g, '/').endsWith('crawler.js')) {
  await runCrawl();
}
