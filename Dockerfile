# syntax=docker/dockerfile:1
# Multi-stage build producing a lean Next.js standalone runtime image.

FROM node:22-alpine AS base
# libc6-compat: some Next.js native deps expect glibc symbols on Alpine
RUN apk add --no-cache libc6-compat

# ---- dependencies ----
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ----
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runtime ----
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Bind all interfaces so the reverse proxy can reach the published port
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# public assets (static-fallback CSV/JSON the client can fetch)
COPY --from=builder /app/public ./public
# standalone server + node_modules subset
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# writable dir for the FRED macro cache (data/raw/macro_fred.json)
RUN mkdir -p /app/data/raw && chown -R nextjs:nodejs /app/data

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
