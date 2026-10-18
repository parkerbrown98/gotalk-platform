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
RUN pnpm build \
  && pnpm --filter @gotalk-platform/web deploy --prod --legacy /out

FROM node:24-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server/entry.mjs"]
