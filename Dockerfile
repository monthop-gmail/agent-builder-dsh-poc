# syntax=docker/dockerfile:1
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY . .
RUN npm run build

ENTRYPOINT ["node", "/app/dist/cli/index.js"]
CMD ["targets"]
