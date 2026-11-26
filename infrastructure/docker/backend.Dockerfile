FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
RUN npm ci
COPY database ./database
RUN npx prisma generate --schema database/schema.prisma
COPY apps/backend ./apps/backend
RUN npm run build -w apps/backend
USER node
EXPOSE 4040
CMD ["node", "apps/backend/dist/server.js"]
