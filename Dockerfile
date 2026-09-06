FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 appuser

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/firebase-applet-config.json ./firebase-applet-config.json

# data/ holds runtime state (settings, thresholds, the bookings cache) and is
# deliberately not in version control - it carries real bookings and guest
# details. The server creates the files it needs on first use, so the image
# only needs the directory to exist and be writable.
RUN mkdir -p /app/data && chown -R appuser:nodejs /app/data

USER appuser

EXPOSE 3000

CMD ["node", "dist/server.cjs"]
