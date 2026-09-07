# Combined Dockerfile: find_football (Node+Puppeteer) + tizenbrew-kit (Python yt-dlp-resolver)
# Render free tier: one container running both services via nginx reverse proxy
FROM node:22-slim

# ---------- Install system deps for both runtimes ----------
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    chromium \
    python3 \
    python3-pip \
    ffmpeg \
    nginx \
    curl \
  && rm -rf /var/lib/apt/lists/* \
  && ln -sf /usr/bin/chromium /usr/local/bin/chromium \
  && ln -sf /usr/bin/python3 /usr/local/bin/python \
  && ln -sf /usr/bin/pip3 /usr/local/bin/pip

# ---------- Puppeteer Chromium path ----------
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# ---------- Copy find_football ----------
WORKDIR /app
COPY find_football/package*.json ./find_football/
RUN cd find_football && npm install --omit=dev

# ---------- Copy tizenbrew-kit backend (Python FastAPI) ----------
COPY tizenbrew-kit/backend/yt-dlp-resolver/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
RUN pip install --no-cache-dir yt-dlp

# ---------- Copy application source code ----------
COPY find_football ./find_football
COPY tizenbrew-kit/backend/yt-dlp-resolver/app.py /app/yt-dlp-resolver/app.py

# ---------- Expose ports ----------
EXPOSE 80 8000 3000

# ---------- Nginx reverse proxy config ----------
COPY nginx.conf /etc/nginx/nginx.conf

# ---------- Start both services ----------
# find_football runs on $PORT (Render assigns)
# tizenbrew-kit backend runs on 8000
CMD ["sh", "-c", "nginx && node /app/find_football/server.js & uvicorn app:app --host 0.0.0.0 --port 8000 & wait"]