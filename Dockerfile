# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY . .
RUN npm ci && npm run build

# High internal ports let the edge proxy run without root or bind capabilities.
FROM caddy:2.11.7-alpine AS proxy
RUN mkdir -p /data /config && chown -R 1000:1000 /data /config
USER 1000:1000

FROM node:24-bookworm-slim AS studio
WORKDIR /app
# Workspace exports point at TypeScript sources; tsx is a pinned dev dependency.
# Retain workspace sources and node_modules, not a production-only npm prune.
COPY --from=build /app /app
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production \
    VW_DATA_ROOT=/data
USER node
VOLUME ["/data"]
EXPOSE 3001
STOPSIGNAL SIGTERM
CMD ["node", "--import", "tsx", "apps/web/server/index.ts"]
