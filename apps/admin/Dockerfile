# Next.js admin dashboard. Standalone output keeps the runtime layer small and
# free of the build toolchain.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH TZ=UTC
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/admin/package.json apps/admin/
COPY packages/shared/package.json packages/shared/
COPY packages/config/package.json packages/config/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ARG NEXT_PUBLIC_API_ORIGIN
ARG NEXT_PUBLIC_ENV=PRODUCTION
ENV NEXT_PUBLIC_API_ORIGIN=$NEXT_PUBLIC_API_ORIGIN NEXT_PUBLIC_ENV=$NEXT_PUBLIC_ENV
RUN pnpm --filter @paysync/admin build

FROM base AS runtime
ENV NODE_ENV=production PORT=3001
COPY --from=build /app/apps/admin/.next/standalone ./
COPY --from=build /app/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=build /app/apps/admin/public ./apps/admin/public

USER node
EXPOSE 3001
CMD ["node", "apps/admin/server.js"]
