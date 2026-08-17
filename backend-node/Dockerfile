# ── Backend Node API ──
FROM node:20-alpine

WORKDIR /app

# Install dependencies first for better layer caching
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copy application source
COPY . .

EXPOSE 5000

CMD ["node", "apiServer.js"]
