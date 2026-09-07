# Combined Dockerfile for find_football + tizenbrew-kit
# One container runs both services via nginx reverse proxy
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

# ---------- Install Node.js dependencies ----------
WORKDIR /app

# Copy find_football package.json and install
COPY find_football/package*.json ./find_football/
RUN cd find_football && npm install --omit=dev

# Copy tizenbrew-kit monorepo
COPY tizenbrew-kit/package*.json tizenbrew-kit/pnpm-workspace.yaml tizenbrew-kit/pnpm-lock.yaml ./tizenbrew-kit/
RUN cd tizenbrew-kit && npm install -g pnpm@10.12.1 && pnpm install --frozen-lockfile --prod

# Copy application source code
COPY find_football ./find_football
COPY tizenbrew-kit/packages ./tizenbrew-kit/packages
COPY nginx.conf /etc/nginx/nginx.conf

# Install Python dependencies and yt-dlp
COPY tizenbrew-kit/backend/yt-dlp-resolver/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
RUN pip install --no-cache-dir yt-dlp

# ---------- Expose ports ----------
EXPOSE 80 8000 3000

# ---------- Start both services ----------
# find_football runs on $PORT (Render assigns)
# tizenbrew-kit backend runs on 8000
CMD ["sh", "-c", "nginx && node /app/find_football/server.js & uvicorn app:app --host 0.0.0.0 --port 8000 & wait"]