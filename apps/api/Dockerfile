# syntax=docker/dockerfile:1
# Build from the repository root:  docker build -f apps/api/Dockerfile -t caselind-api .

FROM node:22-slim AS build
WORKDIR /app
# Manifests first (layer cache). The mobile manifest is needed so the lockfile matches the workspaces.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
COPY apps/web/package.json apps/web/
RUN npm ci -w @caselind/contracts -w @caselind/api
COPY packages/contracts packages/contracts
COPY apps/api apps/api
# Builds packages/contracts, then compiles the API to apps/api/dist.
RUN npm run build -w @caselind/api

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev -w @caselind/contracts -w @caselind/api

FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    MEDIA_STORAGE_DIR=/data/media
WORKDIR /app
COPY --from=deps /app/package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/packages/contracts/package.json packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist packages/contracts/dist
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/migrations apps/api/migrations
RUN mkdir -p /data/media && chown -R node:node /data
USER node
WORKDIR /app/apps/api
EXPOSE 3000
VOLUME ["/data/media"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# main.js applies pending migrations (db/migrator) before listening.
CMD ["node", "dist/main.js"]
