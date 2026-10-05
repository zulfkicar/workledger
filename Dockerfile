FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-fund --no-audit && chown -R node:node /app
COPY --chown=node:node server ./server
COPY --chown=node:node web ./web
RUN mkdir /app/.data && chown node:node /app/.data
USER node
ENV HOST=0.0.0.0 PORT=8770 DATABASE_PATH=/app/.data/workledger.sqlite
EXPOSE 8770
CMD ["node", "server/index.js"]
