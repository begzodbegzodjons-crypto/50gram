# ============================================================
# 50 Gram — ishlab chiqarish image'i (Next.js + chat-service)
# Bitta image, ikkala xizmat uchun (docker-compose'da command bilan ajratiladi)
# ============================================================

# ---------- 1-bosqich: bog'liqliklar + Prisma client ----------
FROM oven/bun:1-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY prisma ./prisma
# PRISMA_SCHEMA: SQLite (default) yoki prisma/schema-mysql.prisma (TiDB bosqichi)
ARG PRISMA_SCHEMA=prisma/schema.prisma
RUN bun install --frozen-lockfile && bunx prisma generate --schema ${PRISMA_SCHEMA}

# ---------- 2-bosqich: Next.js build ----------
FROM oven/bun:1-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# DATABASE_URL build vaqtida ham kerak (prisma generate/schema uchun)
ENV DATABASE_URL=file:/tmp/build-placeholder.db
RUN bun run build

# ---------- 3-bosqich: ishga tushirish (runner) ----------
FROM oven/bun:1-slim AS runner
WORKDIR /app

# To'liq node_modules (chat-service Prisma client + socket.io ishlatadi)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next/standalone ./.next/standalone
COPY --from=builder /app/mini-services ./mini-services
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json

# Static fayllar standalone'ga nusxalangan (build script bajaradi)
COPY --from=builder /app/public ./public

# Baza fayli volume'ga yoziladi: DATABASE_URL=file:/app/db/50gram.db
RUN mkdir -p /app/db
VOLUME ["/app/db"]

# Lokal .env ni kopyalamaymiz — env compose'da beriladi
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

EXPOSE 3000 3003

# compose'da:
#   web  -> bun .next/standalone/server.js
#   chat -> bun mini-services/chat-service/index.ts
CMD ["bun", ".next/standalone/server.js"]
