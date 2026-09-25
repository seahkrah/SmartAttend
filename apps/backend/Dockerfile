# syntax=docker/dockerfile:1.7
#
# The API. Build from the repository root, because it depends on
# packages/types:
#
#   docker build -f apps/backend/Dockerfile -t jjelotech-api .
#
# Debian rather than Alpine: the face-matching engine uses @tensorflow/tfjs-node,
# whose native binding is built against glibc and does not load on musl.
#
# Behind a TLS-intercepting proxy, pass its CA as a build secret:
#   docker build --secret id=ca,src=/path/to/ca.pem ...
# It is used only while installing packages and is not kept in the image.

FROM node:20-bookworm-slim AS build
WORKDIR /src

COPY packages/types/package*.json packages/types/
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca npm_config_cafile=/run/secrets/ca; fi; \
    cd packages/types && npm ci --no-audit --no-fund
COPY packages/types packages/types
RUN cd packages/types && npm run build

COPY apps/backend/package*.json apps/backend/
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca npm_config_cafile=/run/secrets/ca; fi; \
    cd apps/backend && npm ci --no-audit --no-fund
COPY apps/backend apps/backend
# tsc does not copy the SQL migrations; the runner reads them from beside itself.
RUN cd apps/backend \
 && npx tsc -p tsconfig.build.json \
 && cp -r src/db/migrations dist/db/migrations \
 && npm prune --omit=dev --no-audit --no-fund

FROM node:20-bookworm-slim
ENV NODE_ENV=production PORT=5000
WORKDIR /app
# The same layout as the build, so node_modules/@jjelotech/types (a link to
# ../../packages/types) still resolves.
COPY --from=build --chown=node:node /src/packages/types/package.json /app/packages/types/package.json
COPY --from=build --chown=node:node /src/packages/types/dist /app/packages/types/dist
COPY --from=build --chown=node:node /src/apps/backend/package.json /app/apps/backend/package.json
COPY --from=build --chown=node:node /src/apps/backend/node_modules /app/apps/backend/node_modules
COPY --from=build --chown=node:node /src/apps/backend/dist /app/apps/backend/dist
WORKDIR /app/apps/backend
# Uploaded documents live here (mount a volume); it must belong to the
# unprivileged user the server runs as.
RUN mkdir -p /data/files && chown node:node /data/files
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Migrations are a separate, deliberate step:
#   docker run --rm --env-file .env jjelotech-api node dist/db/migrate.js
CMD ["node", "dist/server.js"]
