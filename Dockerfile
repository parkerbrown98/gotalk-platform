# syntax=docker/dockerfile:1

FROM node:24-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /src

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

COPY . .
# SITE_URL sets canonical and sitemap URLs. PUBLIC_NOINDEX=true builds a staging site search engines skip.
ARG SITE_URL=https://gotalk.sh
ARG PUBLIC_NOINDEX=false
ENV SITE_URL=$SITE_URL PUBLIC_NOINDEX=$PUBLIC_NOINDEX
# The build bakes in a snapshot of the latest releases and pulls the server's Compose quick start. The
# optional github_token secret only raises the GitHub rate limit; it is not stored in the image.
RUN --mount=type=secret,id=github_token,env=GITHUB_TOKEN pnpm build \
  && pnpm --filter @gotalk-platform/web deploy --prod --legacy /out

FROM node:24-slim
# DATA_DIR keeps the latest release list across restarts; mount a volume there to keep it across upgrades.
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATA_DIR=/data
WORKDIR /app
COPY --from=build --chown=node:node /out ./
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server/entry.mjs"]
