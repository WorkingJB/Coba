FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig*.json vite.config.ts ./
COPY apps ./apps
COPY packages ./packages
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/web-dist ./web-dist
COPY --chown=node:node db ./db
USER node
EXPOSE 8080
CMD ["node", "dist/apps/api/src/index.js"]
