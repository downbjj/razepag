FROM node:20-alpine AS production

RUN apk add --no-cache dumb-init openssl libc6-compat

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json tsconfig*.json ./
COPY prisma ./prisma
COPY src ./src
COPY app.js ./

RUN npm install --ignore-scripts && \
    ./node_modules/.bin/prisma generate && \
    npm cache clean --force

EXPOSE 3001

ENTRYPOINT ["dumb-init", "--"]
CMD ["sh", "-c", "./node_modules/.bin/prisma db push --schema=prisma/schema.prisma && node app.js"]
