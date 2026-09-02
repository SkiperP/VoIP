FROM node:22-alpine AS web
WORKDIR /web
COPY apps/web/package.json ./
RUN npm install
COPY apps/web ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY apps/api/package.json ./
RUN npm install --omit=dev
COPY apps/api ./
COPY --from=web /web/dist ./public
ENV APP_PORT=3080
EXPOSE 3080
CMD ["node", "src/index.js"]
