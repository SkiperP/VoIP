FROM node:22-alpine AS web
WORKDIR /web
ARG VITE_BASE=/
ENV VITE_BASE=$VITE_BASE
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY apps/api/package.json apps/api/package-lock.json ./
RUN npm ci --omit=dev
COPY apps/api ./
COPY --from=web /web/dist ./public
ENV APP_PORT=3080
EXPOSE 3080
CMD ["node", "src/index.js"]
