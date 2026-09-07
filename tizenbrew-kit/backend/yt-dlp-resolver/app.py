import asyncio
import json
import os
import re
import subprocess
import urllib.error
import urllib.request
from contextlib import asynccontextmanager
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, Response, StreamingResponse
from pydantic import BaseModel
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool


@asynccontextmanager
async def lifespan(application: FastAPI):
    limits = httpx.Limits(max_connections=20, max_keepalive_connections=10)
    timeout = httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=10.0)
    async with httpx.AsyncClient(
        limits=limits,
        timeout=timeout,
        follow_redirects=False,
    ) as client:
        application.state.http_client = client
        yield


app = FastAPI(title="yt-dlp Resolver", version="0.4.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_KEY = os.environ.get("API_KEY", "")
YT_DLP = os.environ.get("YT_DLP_PATH", "yt-dlp")
FACEBOOK_FORMAT = "hd/sd/b"
SOURCE_HOST_SUFFIXES = ("facebook.com", "fb.watch", "tiktok.com", "bilibili.tv", "youtube.com", "youtu.be")
TIKTOK_CDN_HOST_SUFFIXES = ("tiktok.com", "tiktokcdn.com", "tiktokv.com", "byteoversea.com")
YOUTUBE_CDN_HOST_SUFFIXES = ("googlevideo.com", "youtube.com")
VIDEO_CDN_HOST_SUFFIXES = ("fbcdn.net", "bilivideo.com", *TIKTOK_CDN_HOST_SUFFIXES, *YOUTUBE_CDN_HOST_SUFFIXES)

BILIBILI_FORMAT = "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio/bestvideo+bestaudio/best"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
TIKTOK_REDIRECT_STATUSES = (301, 302, 303, 307, 308)


class NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


# ─── TikTok Resolver ─────────────────────────────────────────────

def extract_video_id(url: str) -> str | None:
    for pattern in [r"/video/(\d{9,19})", r"/v/(\d{9,19})"]:
        m = re.search(pattern, url, re.I)
        if m:
            return m.group(1)
    return None


def tiktok_try_api(video_id: str) -> dict | None:
    api_url = f"https://www.tiktok.com/api/item/detail/?itemId={video_id}&aid=1988"
    req = urllib.request.Request(api_url, headers={
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.tiktok.com/",
    })
    try:
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read().decode())
        item = (data.get("itemInfo") or {}).get("itemStruct") or {}
        video = item.get("video") or {}
        play_addr = video.get("playAddr")
        if not play_addr:
            return None
        author = item.get("author") or {}
        return {
            "videoUrl": play_addr,
            "title": (item.get("desc") or "")[:200] or f"Video by @{author.get('uniqueId', 'unknown')}",
            "thumbnailUrl": video.get("cover"),
            "author": author.get("uniqueId", "unknown"),
        }
    except Exception:
        return None


def tiktok_try_html(url: str) -> dict | None:
    try:
        resp = tiktok_open_url(url)
        html = resp.read().decode("utf-8", errors="replace")
    except Exception:
        return None

    m = re.search(r'<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)</script>', html, re.I)
    if m:
        try:
            scope = json.loads(m.group(1)).get("__DEFAULT_SCOPE__", {})
            detail = (scope.get("webapp.video-detail") or {}).get("itemInfo", {}).get("itemStruct") or {}
            video = detail.get("video") or {}
            play_addr = video.get("playAddr")
            if play_addr:
                author = detail.get("author") or {}
                return {
                    "videoUrl": play_addr,
                    "title": (detail.get("desc") or "")[:200] or f"Video by @{author.get('uniqueId', 'unknown')}",
                    "thumbnailUrl": video.get("cover"),
                    "author": author.get("uniqueId", "unknown"),
                }
        except Exception:
            pass

    for pattern in [r'"playAddr"\s*:\s*"([^"]+)"', r'"play_url"\s*:\s*"([^"]+)"', r'"downloadAddr"\s*:\s*"([^"]+)"']:
        m = re.search(pattern, html)
        if m:
            vid_url = m.group(1).replace("\\u002F", "/").replace("\\/", "/")
            author_m = re.search(r"@(\w+)", html)
            return {
                "videoUrl": vid_url,
                "title": "TikTok Video",
                "thumbnailUrl": None,
                "author": author_m.group(1) if author_m else "unknown",
            }
    return None


def resolve_tiktok(url: str) -> dict | None:
    video_id = extract_video_id(url)
    if video_id:
        result = tiktok_try_api(video_id)
        if result:
            return result
    return tiktok_try_html(url)


def is_tiktok_url(url: str) -> bool:
    return url_has_host_suffix(url, ("tiktok.com",))


def is_facebook_url(url: str) -> bool:
    return bool(re.search(r"(?:www\.|m\.)?(?:facebook\.com|fb\.watch)", url))


def is_bilibili_url(url: str) -> bool:
    return bool(re.search(r"(?:www\.)?bilibili\.tv", url))


def is_youtube_url(url: str) -> bool:
    return bool(re.search(r"(?:www\.)?(?:youtube\.com|youtu\.be)", url))


def tiktok_open_url(url: str):
    opener = urllib.request.build_opener(NoRedirectHandler())
    current_url = url
    redirect_count = 0

    while True:
        if not is_tiktok_url(current_url):
            raise ValueError("Unsupported TikTok redirect target")
        request = urllib.request.Request(current_url, headers={
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        })
        try:
            response = opener.open(request, timeout=15)
        except urllib.error.HTTPError as exc:
            if exc.code not in TIKTOK_REDIRECT_STATUSES:
                raise
            response = exc

        status = getattr(response, "status", None) or response.getcode()
        if status not in TIKTOK_REDIRECT_STATUSES:
            return response

        location = response.headers.get("Location")
        response.close()
        if not location or redirect_count >= 5:
            raise ValueError("Too many or invalid TikTok redirects")
        next_url = urljoin(current_url, location)
        if not is_tiktok_url(next_url):
            raise ValueError("Unsupported TikTok redirect target")
        current_url = next_url
        redirect_count += 1


# ─── Helpers ──────────────────────────────────────────────────────

class ResolveResult(BaseModel):
    videoUrl: str
    title: str
    thumbnailUrl: str | None = None


class ResolveResponse(BaseModel):
    ok: bool
    resolved: ResolveResult | None = None
    error: str | None = None


class DebugResponse(BaseModel):
    ok: bool
    yt_dlp_output: dict | None = None
    stdout: str | None = None
    stderr: str | None = None
    error: str | None = None


def check_api_key(x_api_key: str | None = None) -> None:
    if not API_KEY:
        raise HTTPException(status_code=503, detail="API key is not configured")
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


def run_yt_dlp(url: str, extra_args: list[str] | None = None) -> subprocess.CompletedProcess:
    cmd = [YT_DLP, "--dump-json", "--no-download"]
    if extra_args:
        cmd.extend(extra_args)
    cmd.append(url)
    try:
        return subprocess.run(cmd, capture_output=True, timeout=60,
                              encoding="utf-8", errors="replace")
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail=f"yt-dlp not found at '{YT_DLP}'")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="yt-dlp timed out")


def extract_video_url(data: dict) -> str | None:
    url = data.get("url") or ""
    if url and url.startswith("http"):
        return url
    for fmt in data.get("requested_formats") or []:
        fu = fmt.get("url") or ""
        if fu and fu.startswith("http") and fmt.get("vcodec", "none") != "none":
            return fu
    for fmt in reversed(data.get("formats") or []):
        fu = fmt.get("url") or ""
        if fu and fu.startswith("http") and fmt.get("vcodec", "none") != "none":
            return fu
    return None


def url_has_host_suffix(url: str, suffixes: tuple[str, ...]) -> bool:
    try:
        parsed = urlparse(url)
        hostname = parsed.hostname
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https") or not hostname:
        return False
    hostname = hostname.lower().rstrip(".")
    return any(hostname == suffix or hostname.endswith(f".{suffix}") for suffix in suffixes)


def proxy_headers(source_url: str, range_header: str | None) -> dict[str, str]:
    headers = {"User-Agent": UA, "Accept": "*/*", "Accept-Encoding": "identity"}
    if is_facebook_url(source_url) or "fbcdn.net" in source_url:
        headers["Referer"] = "https://www.facebook.com/"
        headers["Origin"] = "https://www.facebook.com"
    elif is_tiktok_url(source_url) or url_has_host_suffix(source_url, TIKTOK_CDN_HOST_SUFFIXES):
        headers["Referer"] = "https://www.tiktok.com/"
        headers["Origin"] = "https://www.tiktok.com"
    elif is_bilibili_url(source_url) or "bilivideo.com" in source_url:
        headers["Referer"] = "https://www.bilibili.tv/"
        headers["Origin"] = "https://www.bilibili.tv"
    if range_header:
        headers["Range"] = range_header
    return headers


async def proxy_cdn(request: Request, cdn_url: str, source_url: str) -> StreamingResponse:
    client: httpx.AsyncClient = request.app.state.http_client
    upstream_request = client.build_request(
        "GET",
        cdn_url,
        headers=proxy_headers(source_url, request.headers.get("range")),
    )
    try:
        upstream = await client.send(upstream_request, stream=True)
    except httpx.TimeoutException as exc:
        raise HTTPException(status_code=504, detail=f"CDN timeout: {exc}")
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"CDN fetch failed: {exc}")

    response_headers = {}
    for name in ("content-type", "content-length", "content-range", "accept-ranges", "location", "content-encoding"):
        value = upstream.headers.get(name)
        if value:
            response_headers[name.title()] = value

    async def iter_upstream():
        try:
            async for chunk in upstream.aiter_raw(chunk_size=256 * 1024):
                yield chunk
        finally:
            await upstream.aclose()

    return StreamingResponse(
        iter_upstream(),
        status_code=upstream.status_code,
        headers=response_headers,
        background=BackgroundTask(upstream.aclose),
    )


def resolve_and_get_cdn(url: str) -> str:
    if is_tiktok_url(url):
        result = resolve_tiktok(url)
        if result and result.get("videoUrl"):
            return result["videoUrl"]
        raise HTTPException(status_code=422, detail="Failed to resolve TikTok URL")

    if is_facebook_url(url):
        cmd = [
            YT_DLP,
            "-f",
            FACEBOOK_FORMAT,
            "--get-url",
            "--no-check-certificates",
            "--user-agent",
            UA,
            url,
        ]
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=60,
                               encoding="utf-8", errors="replace")
        except FileNotFoundError:
            raise HTTPException(status_code=500, detail=f"yt-dlp not found at '{YT_DLP}'")
        except subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="yt-dlp resolve timed out")
        if r.returncode != 0:
            raise HTTPException(status_code=422, detail=r.stderr.strip()[-500:] or "yt-dlp failed")
        lines = [l.strip() for l in r.stdout.strip().split("\n") if l.strip().startswith("http")]
        if lines:
            return lines[0]
        raise HTTPException(status_code=422, detail="No video URL found")

    if is_bilibili_url(url):
        extra_args = ["-f", BILIBILI_FORMAT, "--user-agent", UA]
        r = run_yt_dlp(url, extra_args)
        if r.returncode != 0:
            raise HTTPException(status_code=422, detail=r.stderr.strip()[-500:] or "yt-dlp failed")
        try:
            data = json.loads(r.stdout.strip())
        except json.JSONDecodeError:
            raise HTTPException(status_code=500, detail="Failed to parse yt-dlp output")
        video_url = extract_video_url(data)
        if not video_url:
            raise HTTPException(status_code=422, detail="No video URL found")
        return video_url

    if is_youtube_url(url):
        extra_args = [
            "-f", "best[ext=mp4]/best",
            "--user-agent", UA,
            "--no-check-certificates",
        ]
        r = run_yt_dlp(url, extra_args)
        if r.returncode != 0:
            raise HTTPException(status_code=422, detail=r.stderr.strip()[-500:] or "yt-dlp failed")
        try:
            data = json.loads(r.stdout.strip())
        except json.JSONDecodeError:
            raise HTTPException(status_code=500, detail="Failed to parse yt-dlp output")
        video_url = extract_video_url(data)
        if not video_url:
            raise HTTPException(status_code=422, detail="No video URL found")
        return video_url

    return url


def build_bilibili_dash_mpd(source_url: str) -> str:
    extra_args = ["-f", BILIBILI_FORMAT, "--user-agent", UA]
    r = run_yt_dlp(source_url, extra_args)
    if r.returncode != 0:
        raise HTTPException(status_code=422, detail=r.stderr.strip()[-500:] or "yt-dlp failed")
    try:
        data = json.loads(r.stdout.strip())
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse yt-dlp output")

    video_url = None
    audio_url = None
    video_codec = "avc1.64001E"
    audio_codec = "mp4a.40.2"
    width = 640
    height = 360
    bandwidth = 500000
    abr = 96000
    duration = 0

    for fmt in data.get("requested_formats") or []:
        fu = fmt.get("url") or ""
        vc = fmt.get("vcodec", "none")
        if fu and vc != "none":
            video_url = fu
            video_codec = vc
            width = fmt.get("width", width)
            height = fmt.get("height", height)
            bandwidth = fmt.get("tbr", fmt.get("vbr", bandwidth)) * 1000
        elif fu and fmt.get("acodec", "none") != "none":
            audio_url = fu
            audio_codec = fmt.get("acodec", audio_codec)
            abr = fmt.get("abr", fmt.get("tbr", abr))

    if not video_url or not audio_url:
        raise HTTPException(status_code=422, detail="Could not extract both video and audio streams")

    dur_float = data.get("duration")
    if dur_float:
        duration = int(dur_float)

    ve = video_url.replace("&", "&amp;")
    ae = audio_url.replace("&", "&amp;")

    lines = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" type="static" minBufferTime="PT2S"',
    ]
    if duration > 0:
        h, m = divmod(duration, 3600)
        m, s = divmod(m, 60)
        lines[1] += f' mediaPresentationDuration="PT{int(h)}H{int(m)}M{int(s)}S"'
    lines[1] += ">"
    lines.append("  <Period>")
    lines.append(f'    <AdaptationSet mimeType="video/mp4" contentType="video" width="{width}" height="{height}" segmentAlignment="true" startWithSAP="1">')
    lines.append(f'      <Representation bandwidth="{bandwidth}" codecs="{video_codec}" id="video">')
    lines.append(f"        <BaseURL>{ve}</BaseURL>")
    lines.append("      </Representation>")
    lines.append("    </AdaptationSet>")
    lines.append('    <AdaptationSet mimeType="audio/mp4" contentType="audio" segmentAlignment="true" startWithSAP="1">')
    lines.append(f'      <Representation bandwidth="{int(abr) * 1000}" codecs="{audio_codec}" id="audio">')
    lines.append(f"        <BaseURL>{ae}</BaseURL>")
    lines.append("      </Representation>")
    lines.append("    </AdaptationSet>")
    lines.append("  </Period>")
    lines.append("</MPD>")
    return "\n".join(lines)


# ─── Routes ───────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"ok": True, "version": "0.4.0"}


@app.get("/resolve", response_model=ResolveResponse)
def resolve(url: str, x_api_key: str | None = Header(None)):
    check_api_key(x_api_key)
    if not url_has_host_suffix(url, SOURCE_HOST_SUFFIXES):
        raise HTTPException(status_code=400, detail="Unsupported source URL")

    if is_tiktok_url(url):
        result = resolve_tiktok(url)
        if not result:
            raise HTTPException(status_code=422, detail="Failed to resolve TikTok URL")
        return ResolveResponse(ok=True, resolved=ResolveResult(
            videoUrl=result["videoUrl"], title=result.get("title", ""),
            thumbnailUrl=result.get("thumbnailUrl"),
        ))

    extra_args = None
    if is_facebook_url(url):
        extra_args = [
            "-f",
            FACEBOOK_FORMAT,
            "--no-check-certificates",
            "--user-agent",
            UA,
        ]
    elif is_bilibili_url(url):
        extra_args = [
            "-f",
            BILIBILI_FORMAT,
            "--user-agent",
            UA,
        ]
    elif is_youtube_url(url):
        extra_args = [
            "-f", "best[ext=mp4]/best",
            "--no-check-certificates",
            "--user-agent",
            UA,
        ]
    r = run_yt_dlp(url, extra_args)
    if r.returncode != 0:
        raise HTTPException(status_code=422, detail=r.stderr.strip() or "yt-dlp failed")
    try:
        data = json.loads(r.stdout.strip())
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="Failed to parse yt-dlp output")
    video_url = extract_video_url(data)
    if not video_url:
        raise HTTPException(status_code=422, detail="No playable video URL found")
    return ResolveResponse(ok=True, resolved=ResolveResult(
        videoUrl=video_url, title=data.get("title", "") or "",
        thumbnailUrl=data.get("thumbnail"),
    ))


@app.get("/dash")
def dash(url: str, x_api_key: str | None = Header(None), api_key: str | None = Query(None)):
    check_api_key(x_api_key or api_key)
    if not url or not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(status_code=400, detail="Invalid or missing url parameter")
    if not is_bilibili_url(url):
        raise HTTPException(status_code=400, detail="Only Bilibili URLs supported")
    mpd = build_bilibili_dash_mpd(url)
    return Response(content=mpd, media_type="application/dash+xml")


async def stream_bilibili_merged(source_url: str) -> StreamingResponse:
    cmd = [YT_DLP, "-f", BILIBILI_FORMAT, "--merge-output-format", "mp4",
           "--user-agent", UA, "-o", "-", source_url]
    try:
        process = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail=f"yt-dlp not found at '{YT_DLP}'")

    async def iter_merged():
        try:
            while True:
                chunk = await process.stdout.read(256 * 1024)
                if not chunk:
                    break
                yield chunk
        finally:
            if process.returncode is None:
                process.kill()
            await process.wait()

    return StreamingResponse(iter_merged(), media_type="video/mp4")


@app.get("/play")
async def play(request: Request, url: str, mode: str = Query("proxy"),
               direct: str | None = Query(None),
               x_api_key: str | None = Header(None), api_key: str | None = Query(None)):
    check_api_key(x_api_key or api_key)
    if not url or not (url.startswith("http://") or url.startswith("https://")):
        raise HTTPException(status_code=400, detail="Invalid or missing url parameter")
    if mode not in ("redirect", "proxy"):
        raise HTTPException(status_code=400, detail="Invalid mode")

    if is_bilibili_url(url):
        if mode == "proxy":
            return await stream_bilibili_merged(url)
        api = x_api_key or api_key or ""
        proxy_url = f"/play?mode=proxy&url={url}&api_key={api}"
        return RedirectResponse(proxy_url, status_code=302)

    if direct == "1":
        if not url_has_host_suffix(url, VIDEO_CDN_HOST_SUFFIXES):
            raise HTTPException(status_code=400, detail="Unsupported video CDN host")
        cdn_url = url
    else:
        if not url_has_host_suffix(url, SOURCE_HOST_SUFFIXES):
            raise HTTPException(status_code=400, detail="Unsupported source host")
        cdn_url = await run_in_threadpool(resolve_and_get_cdn, url)
    if not url_has_host_suffix(cdn_url, VIDEO_CDN_HOST_SUFFIXES):
        raise HTTPException(status_code=502, detail="Resolver returned unsupported video CDN host")
    if mode == "redirect":
        return RedirectResponse(cdn_url, status_code=302)
    return await proxy_cdn(request, cdn_url, url)


@app.get("/debug", response_model=DebugResponse)
def debug(url: str = Query(...), x_api_key: str | None = Header(None)):
    check_api_key(x_api_key)
    if not url_has_host_suffix(url, SOURCE_HOST_SUFFIXES):
        raise HTTPException(status_code=400, detail="Unsupported source URL")

    if is_tiktok_url(url):
        result = resolve_tiktok(url)
        if not result:
            return DebugResponse(ok=False, error="TikTok resolver failed")
        return DebugResponse(ok=True, yt_dlp_output={
            "title": result.get("title"), "videoUrl": result.get("videoUrl"),
            "thumbnailUrl": result.get("thumbnailUrl"), "author": result.get("author"),
            "source": "tiktok_resolver",
        })

    result = run_yt_dlp(url)
    if result.returncode != 0:
        return DebugResponse(ok=False, stdout=result.stdout.strip() or None,
                             stderr=result.stderr.strip() or None, error="yt-dlp failed")
    try:
        data = json.loads(result.stdout.strip())
        return DebugResponse(ok=True, yt_dlp_output=data)
    except json.JSONDecodeError as e:
        return DebugResponse(ok=False, stdout=result.stdout.strip()[:2000],
                             stderr=str(e), error="JSON parse failed")
