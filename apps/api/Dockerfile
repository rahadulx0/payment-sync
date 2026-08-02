# Multi-stage build for the API and worker (they share one image; the command
# differs). Non-root, no build toolchain in the final layer.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH TZ=UTC
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/parsers/package.json packages/parsers/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @paysync/api exec prisma generate \
    && pnpm --filter @paysync/shared build \
    && pnpm --filter @paysync/parsers build \
    && pnpm --filter @paysync/api exec tsc -p tsconfig.build.json

FROM base AS runtime
ENV NODE_ENV=production
# Prisma needs its engines and the schema at runtime for `migrate deploy`.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/package.json ./package.json

USER node
EXPOSE 3000
# Overridden to `dist/src/workers/main.js` for the worker service.
CMD ["node", "apps/api/dist/src/main.js"]
