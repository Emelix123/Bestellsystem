# Druck-Agent als Container – für USB-Drucker, die direkt am Server hängen.
# Auf einem Raspberry Pi ist das Installationsskript meist einfacher (siehe docs/BETRIEB.md).

FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/agent/package.json apps/agent/
RUN npm ci
COPY packages/shared packages/shared
COPY apps/agent apps/agent
RUN npm -w @bestellsystem/agent run build

FROM node:22-alpine
WORKDIR /agent
COPY --from=build /src/apps/agent/dist/agent.mjs .
CMD ["node", "agent.mjs"]
