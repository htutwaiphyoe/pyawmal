# syntax=docker/dockerfile:1.6

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.18.2 --activate
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @pyawmal/api build

FROM build AS deploy
RUN pnpm --filter @pyawmal/api deploy --prod --legacy /out

FROM node:20-alpine AS runtime
RUN apk add --no-cache tini
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deploy /out /app
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
