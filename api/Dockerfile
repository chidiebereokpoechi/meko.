FROM oven/bun:1.1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM oven/bun:1.1-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Run as non-root.
RUN addgroup -S meko && adduser -S meko -G meko && chown -R meko:meko /app
USER meko
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
