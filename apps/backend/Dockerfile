FROM node:22-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy compiled backend code
COPY dist ./dist

# Expose port
EXPOSE 5000

# Start server
CMD ["node", "dist/server.js"]
