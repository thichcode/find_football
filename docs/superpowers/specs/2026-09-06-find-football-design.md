# FindFootball — App tổng hợp lịch + link xem bóng đá VN

Ngày: 2026-09-06 | Hướng: A (Web tĩnh + Puppeteer crawl khi cần) | Layout: A (List theo giờ)

## 1. Mục tiêu
App web nhỏ giúp tìm nhanh trận hôm nay + link xem từ các trang VN (gavangtv, socolive, xoilac...).
Search tên đội/giải, lọc LIVE, lưu đội yêu thích.

## 2. Kiến trúc
- `index.html` + `app.js` + `style.css`: UI list theo giờ, không framework.
- `sources.js`: cấu hình nguồn {name, scheduleUrl, selectors}. Selectors là best-effort vì HTML các site VN đổi thường xuyên, crawler log warn khi selector lệch.
- `crawler.js` (Node + Puppeteer): quét từng nguồn, timeout 15s/nguồn, output chuẩn.
- `matches.json`: cache để mở nhanh. `manual-links.json`: link tay fallback.
- localStorage: `favTeams[]`, `favLeagues[]`.

## 3. Data model
Match: `{id, home, away, league, kickoffISO, source, links[{label,url}], isLive, updatedAt}`
Khử trùng theo normalized(home+away+kickoff giờ).

## 4. Data flow
1. Mở web -> render ngay từ `matches.json`.
2. Bấm Refresh -> chạy `node crawler.js` -> gộp + dedupe + merge manual-links -> ghi `matches.json` -> re-render, badge LIVE đỏ.
3. Search/filter chạy hoàn toàn client-side, không gọi lại mạng.

## 5. Xử lý lỗi
- Nguồn timeout/bị chặn: skip nguồn, hiện badge "nguồn X lỗi", giữ cache cũ.
- Không có trận: hiện empty state + gợi ý xóa filter.
- Link die: user bấm nguồn khác trong cùng trận; admin bổ sung vào manual-links.

## 6. Testing
- Tay: crawl 3 nguồn chính phải ra >=1 trận; search "MU", "VN"; filter LIVE; fav lưu sau reload.
- Không unit test phức tạp (app nhỏ, YAGNI).

## 7. Không làm (scope out)
- Không backend cron/server, không login, không mobile app, không API trả phí.
