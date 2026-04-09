FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm install

COPY . .
RUN npm run build

FROM node:20-alpine AS production

RUN apk add --no-cache dumb-init openssl libc6-compat

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
COPY prisma ./prisma

# Install all deps (including prisma CLI for generate)
RUN npm install --ignore-scripts && \
    npm install prisma --save-dev --ignore-scripts && \
    npx prisma generate && \
    npm cache clean --force

COPY --from=builder /app/dist ./dist

EXPOSE 3001

ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy --schema=prisma/schema.prisma && node dist/src/main"]
