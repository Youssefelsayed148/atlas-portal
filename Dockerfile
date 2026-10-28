FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV COREPACK_HOME="/pnpm/corepack"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@8.15.8 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ARG NEXT_PUBLIC_APP_URL=https://portal.example.com
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
# These build-time values are non-secret and allow Next.js to trace modules.
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/atlas_build
ENV BETTER_AUTH_SECRET=build-only-placeholder-secret-not-for-runtime
ENV BETTER_AUTH_URL=https://portal.example.com
ENV ATLAS_ALLOW_SIGNUP=false
RUN pnpm build

FROM node:22-alpine AS app
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]

FROM deps AS tools
ENV NODE_ENV=production
COPY . .
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs
USER nextjs
CMD ["pnpm", "--help"]
