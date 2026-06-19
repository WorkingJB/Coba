# Single image: builds the web client, then runs the Colyseus server which
# serves both the websocket match traffic and the static client (see
# server/index.ts). One Fly app, one process. See ARCHITECTURE.md §4.
FROM node:20-alpine
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build        # vite build -> dist/

ENV NODE_ENV=production
ENV PORT=2567
EXPOSE 2567
CMD ["npm", "run", "start"]
