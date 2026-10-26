# Bestellsystem: Server + Weboberfläche in einem Image.
# Der Druck-Agent (agent.mjs) wird mitgebaut und vom Server zum Download angeboten.

FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/agent/package.json apps/agent/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS deps
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/agent/package.json apps/agent/
RUN npm ci --omit=dev --workspace @bestellsystem/server

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    WEB_DIST=/app/web/dist \
    MIGRATIONS_FOLDER=/app/server/drizzle \
    AGENT_DOWNLOADS=/app/agent/dist
WORKDIR /app
COPY --from=deps /src/node_modules ./node_modules
COPY --from=build /src/apps/server/dist ./server/dist
COPY --from=build /src/apps/server/drizzle ./server/drizzle
COPY --from=build /src/apps/web/dist ./web/dist
COPY --from=build /src/apps/agent/dist ./agent/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/dist/index.js"]
