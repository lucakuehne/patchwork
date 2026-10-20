# ---- Build -------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN pnpm install --frozen-lockfile

COPY backend backend
COPY frontend frontend
RUN pnpm --filter frontend build \
 && pnpm --filter backend build \
 && pnpm --filter backend deploy --prod --legacy /out

# ---- Laufzeit ----------------------------------------------------------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HTTPS_PORT=8443 \
    DATA_DIR=/data \
    FRONTEND_DIR=/app/public

COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/backend/drizzle ./drizzle
COPY --from=build /app/frontend/dist ./public

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
# 8080 HTTP, 8443 HTTPS (sobald unter Verwaltung → HTTPS ein Zertifikat eingerichtet ist)
EXPOSE 8080 8443
CMD ["node", "dist/main.js"]
