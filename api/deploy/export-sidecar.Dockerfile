# Export sidecar (§8b): runs Chromium to rasterise board exports. Non-root; on an isolated network
# that can reach only the API. Chromium is further locked to the API host via --host-rules.
FROM oven/bun:1.1-alpine

# System Chromium (not Puppeteer's bundled download — puppeteer-core uses CHROMIUM_PATH).
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont \
    && addgroup -S chromium && adduser -S chromium -G chromium

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN chown -R chromium:chromium /app
USER chromium

ENV CHROMIUM_PATH=/usr/bin/chromium-browser
CMD ["bun", "run", "src/export/worker.ts"]
