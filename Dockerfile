# Nightfall Bastion game server: serves the game and hosts online rooms on one port.
#
#   docker build -t nightfall-bastion .
#   docker run -d --name nightfall -p 3000:3000 -v nightfall-data:/app/data --restart unless-stopped nightfall-bastion
#
# The volume keeps the leaderboards (/app/data/leaderboard.json) across container rebuilds.
#
# Build from a checkout where `npm run import-assets` has already filled public/assets/ (the sprite
# packs aren't in git), or the game will show placeholder characters.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 LEADERBOARD_FILE=/app/data/leaderboard.json
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
RUN mkdir -p /app/data && chown node:node /app/data
VOLUME /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist-server/main.js"]
