# KasetLink POS API image. Build from the repo root:
#   docker build -f backend/Dockerfile -t kasetlink-pos-api .
FROM node:22-alpine AS build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=optional
COPY backend/ ./
RUN npm run build

FROM node:22-alpine
# pg_dump must match the db container's major version (postgres:17); rclone uploads to Google Drive.
RUN apk add --no-cache postgresql17-client rclone tzdata
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 TZ=Asia/Bangkok \
    MIGRATIONS_DIR=/app/postgres/migrations UPLOAD_DIR=/data/uploads BACKUP_DIR=/data/backups \
    RCLONE_CONFIG=/data/rclone/rclone.conf
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --omit=optional && npm cache clean --force
COPY --from=build /app/backend/dist ./dist
COPY postgres/migrations /app/postgres/migrations
RUN mkdir -p /data/uploads /data/backups /data/rclone && chown -R node:node /data
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3001/api/health || exit 1
# Apply pending migrations, then serve.
CMD ["sh", "-c", "node dist/migrate.js && exec node dist/index.js"]
