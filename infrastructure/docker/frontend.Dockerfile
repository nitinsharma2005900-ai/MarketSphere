FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/frontend/package.json apps/frontend/package.json
RUN npm ci
COPY apps/frontend ./apps/frontend
ARG NEXT_PUBLIC_API_URL=http://localhost:4040/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w apps/frontend
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3040 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/apps/frontend/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/frontend/.next/static ./apps/frontend/.next/static
COPY --from=build --chown=node:node /app/apps/frontend/public ./apps/frontend/public
USER node
EXPOSE 3040
HEALTHCHECK --interval=15s --timeout=5s CMD node -e "fetch('http://localhost:3040').then(r=>{if(!r.ok)process.exit(1)})"
CMD ["node", "apps/frontend/server.js"]
