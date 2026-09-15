// lib/firecrawl.js — lấy HTML qua Firecrawl Cloud API khi Puppeteer bị chặn
// (Cloudflare challenge, toys...). Không thêm dependency, dùng fetch có sẵn.
// Env: FIRECRAWL_API_KEY (lấy tại firecrawl.dev, free 500 credits).
import { buildBlvGroups, eventsFromJsonLd } from './normalize.js';

const API = 'https://api.firecrawl.dev/v1/scrape';

// Trả về HTML string, hoặc null nếu không có key / lỗi.
export async function scrapeHtml(url) {
  const key = process.env.FIRECRAWL_API_KEY || '';
  if (!key) return null;
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ url, formats: ['html'], onlyMainContent: false, waitFor: 5000, timeout: 60000 }),
      signal: AbortSignal.timeout(90000),
    });
    const j = await res.json().catch(() => null);
    return (j && j.success && j.data && j.data.html) || null;
  } catch {
    return null;
  }
}

const stripTags = (s) => String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

// Parse card BLV từ HTML tĩnh (cùng template với crawlBlvCards).
export function parseBlvCardsFromHtml(html, pageUrl, src) {
  const items = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && items.length < 300) {
    const attrs = m[1];
    const inner = m[2];
    const href = (attrs.match(/href\s*=\s*"([^"]+)"/i) || [])[1] || '';
    if (!/truc-tiep/i.test(href)) continue;
    const aria = (attrs.match(/aria-label\s*=\s*"([^"]*)"/i) || [])[1] || '';
    const texts = [...inner.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)]
      .map((x) => stripTags(x[1])).filter(Boolean);
    const imgs = [...inner.matchAll(/<img\b[^>]*alt\s*=\s*"([^"]*)"/gi)]
      .map((x) => x[1].trim()).filter(Boolean);
    let abs = href;
    try { abs = new URL(href, pageUrl).href; } catch { /* giữ nguyên */ }
    items.push({ label: aria, texts, imgs, url: abs });
  }
  return buildBlvGroups(items, src.id, src.name);
}

// Parse JSON-LD từ HTML tĩnh.
export function parseJsonLdFromHtml(html, pageUrl, src) {
  const found = [];
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try { found.push(...eventsFromJsonLd(JSON.parse(m[1]))); } catch { /* skip block lỗi */ }
  }
  return found.map((x) => ({ ...x, source: src.id, links: [{ label: src.name, url: pageUrl }] }));
}
