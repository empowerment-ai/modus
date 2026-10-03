# syntax=docker/dockerfile:1.7
#
# Modus: the studio and the server in one image.
#
#   docker build -t modus:local .
#   docker run --rm -p 8787:8787 -v modus-data:/data modus:local     # http://localhost:8787
#
# The build stage runs on the build machine's own architecture (its output is
# plain JavaScript, HTML and CSS), so multi-arch images only repeat the tiny
# runtime stage. The runtime stage has no package manager and no node_modules:
# the server is one bundled file. Configuration: docs/DEPLOYMENT.md.

ARG NODE_VERSION=22

# ---------- Build: install, build the studio, bundle the server ----------
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /src
ENV CI=true
# pnpm comes from the packageManager field in package.json.
RUN npm install --global corepack@latest && corepack enable

# Manifests first, so dependencies are only reinstalled when they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/studio/package.json apps/studio/
COPY apps/server/package.json apps/server/
COPY packages/core/package.json packages/core/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @modus-bpm/studio build \
 && pnpm --filter @modus-bpm/server build \
 && mkdir -p /out/data

# ---------- Runtime ----------
FROM node:${NODE_VERSION}-alpine AS runtime
ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="Modus" \
      org.opencontainers.image.description="Open-source process manager: design, simulate and run business processes on one model." \
      org.opencontainers.image.source="https://github.com/empowerment-ai/modus" \
      org.opencontainers.image.url="https://github.com/empowerment-ai/modus" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.vendor="Empowerment AI" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps \
    HOST=0.0.0.0 \
    PORT=8787 \
    STATIC_DIR=/app/public \
    DATA_DIR=/data

WORKDIR /app
COPY --from=build /src/LICENSE /src/NOTICE ./
COPY --from=build /src/apps/server/dist/ ./
COPY --from=build /src/apps/studio/dist/ ./public/
# The only writable path: JSON snapshots and the event log. Mount a volume here.
COPY --from=build --chown=1000:1000 /out/data /data

# The image's `node` user, by number so Kubernetes can verify runAsNonRoot.
USER 1000:1000
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/api/health" || exit 1
CMD ["node", "server.mjs"]
