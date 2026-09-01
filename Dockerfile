# syntax=docker/dockerfile:1
FROM node:22.14.0-bookworm-slim@sha256:1c18d9ab3af4585870b92e4dbc5cac5a0dc77dd13df1a5905cea89fc720eb05b AS build

ENV CI=true
WORKDIR /app

COPY package.json package-lock.json tsconfig.json tsconfig.base.json vitest.config.ts ./
COPY packages ./packages
COPY services ./services
COPY contracts ./contracts
COPY database ./database
COPY validation ./validation

RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --ignore-scripts \
      --fetch-retries=5 \
      --fetch-retry-mintimeout=1000 \
      --fetch-retry-maxtimeout=10000 \
    && npm run build \
    && npm prune --omit=dev

FROM node:22.14.0-bookworm-slim@sha256:1c18d9ab3af4585870b92e4dbc5cac5a0dc77dd13df1a5905cea89fc720eb05b

LABEL org.opencontainers.image.title="World Semantic Grounding Service" \
      org.opencontainers.image.version="0.2.1"

ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app

RUN groupadd --gid 10001 wsgs \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin wsgs

COPY --from=build --chown=10001:10001 /app /app

USER 10001:10001
EXPOSE 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "services/grounding-api/dist/main.js"]
