FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma

RUN npm install

COPY . .

# Usa o caminho explícito do nest CLI para evitar problemas de PATH
RUN ./node_modules/.bin/nest build

# ─── Produção ────────────────────────────────────────────────
FROM node:20-alpine AS production

RUN apk add --no-cache dumb-init openssl libc6-compat

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY prisma ./prisma

RUN npm install --omit=dev --ignore-scripts && \
    npm install prisma @prisma/client --ignore-scripts && \
    ./node_modules/.bin/prisma generate && \
    npm cache clean --force

COPY --from=builder /app/dist ./dist

EXPOSE 3001

ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "./node_modules/.bin/prisma db push --schema=prisma/schema.prisma && node dist/src/main"]
