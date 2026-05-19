# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.25-alpine AS api-build
ARG GOPROXY=https://goproxy.cn,direct
ENV GOPROXY=${GOPROXY}
WORKDIR /src
COPY server/go.mod server/go.sum ./server/
WORKDIR /src/server
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/skillhub ./cmd/api

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata wget \
 && addgroup -S skillhub && adduser -S -G skillhub -h /app skillhub
WORKDIR /app
COPY --from=api-build /out/skillhub /app/skillhub
COPY --from=web-build /web/dist /app/web
RUN mkdir -p /app/data && chown -R skillhub:skillhub /app
USER skillhub
ENV SKILLHUB_ADDR=:8080 \
    SKILLHUB_DB=/app/data/skillhub.db \
    SKILLHUB_WEB_DIR=/app/web \
    SKILLHUB_SEED=false
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8080/readyz >/dev/null 2>&1 || exit 1
ENTRYPOINT ["/app/skillhub"]
