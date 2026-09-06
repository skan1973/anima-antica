# --- Stage 1: Build ---
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# --- Stage 2: Runtime ---
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Installiamo solo dipendenze di produzione
COPY package*.json ./
RUN npm ci --only=production

# Copiamo i file necessari dallo stage di build
COPY --from=builder /app/server ./server
COPY --from=builder /app/public ./public
COPY --from=builder /app/ecosystem.config.js ./ecosystem.config.js

# Utilizziamo l'utente node già presente in node-alpine per sicurezza
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server/server.js"]

