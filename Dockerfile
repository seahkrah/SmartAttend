# SmartAttend Root Dockerfile
# Multi-stage build for reproducibility

FROM node:18-alpine AS builder
WORKDIR /workspace
COPY package*.json ./
RUN npm ci

# Build all workspaces
COPY . .
RUN npm run build --workspaces

# Runtime image
FROM node:18-alpine
WORKDIR /app

# Copy production dependencies only
COPY --from=builder /workspace/node_modules ./node_modules
COPY --from=builder /workspace/apps/backend/dist ./apps/backend/dist
COPY --from=builder /workspace/apps/backend/node_modules ./apps/backend/node_modules

# Copy package manifests for reference
COPY package.json package-lock.json ./

EXPOSE 5000
CMD ["node", "apps/backend/dist/index.js"]
