# Build: pnpm monorepo -> Next standalone bundle
FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
# System Chromium is used at runtime; skip puppeteer's browser download
ENV PUPPETEER_SKIP_DOWNLOAD=1 \
    NEXT_TELEMETRY_DISABLED=1
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/editor-schema/package.json packages/editor-schema/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @html-editor/web build

# Runtime: standalone server + system Chromium for PDF/thumbnails
FROM node:22-slim AS run
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    CHROME_NO_SANDBOX=1
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
# Static assets (logo etc.) — standalone output does not include public/
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 8080
CMD ["node", "apps/web/server.js"]
