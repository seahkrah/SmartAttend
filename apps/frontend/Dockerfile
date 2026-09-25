# syntax=docker/dockerfile:1.7
#
# The web app, built once and served as static files. Build from the
# repository root (it depends on packages/types):
#
#   docker build -f apps/frontend/Dockerfile \
#     --build-arg VITE_API_BASE_URL=https://api.example.org/api -t jjelotech-web .
#
# The API address is compiled in, so each environment needs its own build.
# Behind a TLS-intercepting proxy: --secret id=ca,src=/path/to/ca.pem

FROM node:20-bookworm-slim AS build
WORKDIR /src
ARG VITE_API_BASE_URL
RUN test -n "$VITE_API_BASE_URL" || (echo "Set --build-arg VITE_API_BASE_URL" && exit 1)

COPY packages/types/package*.json packages/types/
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca npm_config_cafile=/run/secrets/ca; fi; \
    cd packages/types && npm ci --no-audit --no-fund
COPY packages/types packages/types
RUN cd packages/types && npm run build

COPY apps/frontend/package*.json apps/frontend/
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca npm_config_cafile=/run/secrets/ca; fi; \
    cd apps/frontend && npm ci --no-audit --no-fund
COPY apps/frontend apps/frontend
# Read by the build's API contract check (scripts/check-api.mjs); not shipped.
COPY apps/backend/src apps/backend/src
RUN cd apps/frontend && VITE_API_BASE_URL="$VITE_API_BASE_URL" npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
# Rendered to conf.d/default.conf at start, with API_ORIGIN filled in.
ENV API_ORIGIN=""
COPY apps/frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /src/apps/frontend/dist /usr/share/nginx/html
EXPOSE 8080
