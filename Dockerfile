# Gộp 2 service vào 1 container (Render free chỉ cho 1 port public $PORT):
# - Node (find_football) bind $PORT, làm front-door + proxy route python
# - Python (yt-dlp-resolver) chạy nội bộ port 8000
FROM node:22-slim

# Chromium (Puppeteer) + Python + ffmpeg + yt-dlp deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# ---------- find_football (code nằm ở ROOT repo) ----------
WORKDIR /app/football
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

# ---------- yt-dlp-resolver (Python FastAPI) ----------
COPY tizenbrew-kit/backend/yt-dlp-resolver/requirements.txt /tmp/requirements.txt
RUN pip install --break-system-packages --no-cache-dir -r /tmp/requirements.txt \
  && pip install --break-system-packages --no-cache-dir yt-dlp
COPY tizenbrew-kit/backend/yt-dlp-resolver/app.py /app/resolver/app.py

EXPOSE 3000

# Python chạy nền nội bộ :8000, Node chạy foreground giữ container sống
CMD ["sh", "-c", "python3 -m uvicorn app:app --app-dir /app/resolver --host 127.0.0.1 --port 8000 & exec node /app/football/server.js"]
