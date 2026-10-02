# FindFootball — lịch + link xem bóng đá VN

Backend deploy trên Render (Docker): `https://find-football-tizenbrew.onrender.com`
Client TV: TizenBrew module `findfootball-tv` (npm) + WebView APK (load `android.html` từ server).

## Kiến trúc

```
find_football (repo này, Render build từ đây)
├── server.js          Node front-door: file tĩnh + /api/* + proxy sang Python :8000
├── crawler.js         Puppeteer crawl socolive → ghi matches.json (max 100 trận)
├── lib/               normalize.js (parse slug/BLV), firecrawl.js (fallback Cloud)
├── sources.js         scheduleUrl + fallbacks (socolive đổi domain liên tục)
├── index.html/app.js  Web desktop
├── android.html       Android TV (WebView APK load từ server, không cần rebuild APK)
├── tizenbrew-kit/backend/yt-dlp-resolver/
│   ├── app.py         Python FastAPI: /resolve /play /dash (COPY lúc docker build)
│   └── requirements.txt
└── matches.json       Cache trận (ghi mỗi lần crawl, sync 2 chiều với GitHub)
```

Repovény `D:\pupeteer\tizenbrew-kit` (dev chính):
- `packages/templates/findfootball-tv/src/inject.ts` — Tizen app (publish npm `findfootball-tv`)
- `backend/yt-dlp-resolver/` — **bản chuẩn** của `app.py` + tests (`pytest test_app.py`)

## Quy trình sync 2 copy `app.py` (QUAN TRỌNG)

`app.py` tồn tại ở 2 nơi (không submodule):

| Nơi | Vai trò |
|---|---|
| `tizenbrew-kit/backend/yt-dlp-resolver/app.py` | Bản chuẩn: sửa ở đây, có `test_app.py` để verify |
| `find_football/tizenbrew-kit/backend/yt-dlp-resolver/app.py` | Bản Render dùng (Docker COPY). Phải sync tay |

Sửa resolver:

```powershell
# 1. Sửa ở tizenbrew-kit + chạy tests
cd D:\pupeteer\tizenbrew-kit\backend\yt-dlp-resolver
python -m pytest test_app.py -q

# 2. Copy sang find_football
Copy-Item app.py D:\pupeteer\find_football\tizenbrew-kit\backend\yt-dlp-resolver\app.py -Force

# 3. Push find_football → Render auto-rebuild
cd D:\pupeteer\find_football
git add -A; git commit -m "sync: app.py ..."; git push origin main
```

Tương tự `inject.ts` (Tizen): sửa ở `tizenbrew-kit`, build, push, rồi `npm version patch` +
`npm publish --access public --otp=<OTP>` (cần OTP mới mỗi lần).

APK **không cần rebuild** (load `android.html` từ server).

## Sửa sự cố thường gặp

### Crawl không ra tên BLV (label generic "Link 1")

Socolive đổi domain/template liên tục. Check:

1. Mở Google tìm `socolive trực tiếp bóng đá`, lấy domain top1 mở được.
2. Fetch thử, đếm link `/truc-tiep/`. Template hiện tại (2026-09):
   slug `/truc-tiep/<home>-vs-<away>-luc-<HHMM>-ngay-<DD>-<MM>-<YYYY>[/link/N]`,
   tên BLV nằm trong text anchor.
3. Cập nhật `sources.js` (scheduleUrl + bỏ domain chết), chỉnh parser
   (`parseMatchSlug` trong `lib/normalize.js`, selector trong `crawlBlvCards`) nếu slug đổi.
4. `npm test` (27 tests) → push → Render rebuild → bấm "Quet lich moi".

### TV thoát khi play link `/link/N`

Parser đã gom `/link/N` về URL trận gốc (`stripLinkSuffix` trong `lib/normalize.js`),
giữ tên BLV. Nếu site đẻ thêm dạng URL lạ, bổ sung vào `stripLinkSuffix`.

### TV Samsung cũ (2017-2020) không phát được Facebook reel

TV chỉ decode H.264, còn format `hd` của Facebook hay là AV1.
Fix đã có: `FACEBOOK_FORMAT = "best[acodec!=none][vcodec^=avc1][ext=mp4]/sd/b"`
trong `app.py` (ưu tiên progressive H.264 có tiếng → rớt `sd`). Dùng chung cho
cả `/resolve` lẫn `/play`. Reel nào chỉ có AV1 thì TV xem bản SD (mờ nhưng chạy).

### Render deploy fail: health check timeout

- `server.js` không được `await` gì trước `listen` (sync GitHub để fire-and-forget).
- `HOST` default phải là `0.0.0.0` (không phải `127.0.0.1`).

### `matches.json` mất sau khi Render restart

Disk Render là ephemeral. Cơ chế hiện tại:
- Startup: fetch từ `raw.githubusercontent.com/.../matches.json` (không cần token).
- Sau crawl: PUT lên GitHub Contents API (cần env `GITHUB_TOKEN`, scope `repo`).
- Set `GITHUB_TOKEN` trong Render Dashboard → Environment.

## Env vars trên Render

| Key | Dùng cho |
|---|---|
| `GITHUB_TOKEN` | Commit `matches.json` sau crawl (Classic PAT, scope `repo`, No expiration) |
| `TELEGRAM_BOT_TOKEN` | Bot Telegram `/crawl` |
| `ALLOWED_CHAT_IDS` | Chat ID được phép dùng bot |
| `FIRECRAWL_API_KEY` | Crawl qua Firecrawl khi Puppeteer bị chặn (optional) |
