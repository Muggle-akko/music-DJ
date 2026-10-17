FROM node:24.15.0-alpine AS app
WORKDIR /app
ENV NODE_ENV=production PORT=4173 AWUDIO_DATA_DIR=/app/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && mkdir data && chown node:node data
COPY --chown=node:node server.mjs ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public
COPY --chown=node:node config ./config
USER node
EXPOSE 4173
CMD ["node", "server.mjs"]

FROM node:24.15.0-alpine AS netease
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
COPY services/netease-api/package.json services/netease-api/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY --chown=node:node services/netease-api/ ./
USER node
EXPOSE 3000
CMD ["node", "app.js"]
