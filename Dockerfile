# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Install OpenSSL for Prisma and FFmpeg for video processing
RUN apt-get update && apt-get install -y openssl ffmpeg && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Generate Prisma client
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-slim AS production

WORKDIR /app

# Install OpenSSL, FFmpeg for video processing, and wget for health checks
RUN apt-get update && apt-get install -y openssl ffmpeg wget && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 -g nodejs nodejs

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy Prisma schema and generate client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy built application
COPY --from=builder /app/dist ./dist

# Create uploads directory
RUN mkdir -p uploads && chown -R nodejs:nodejs uploads

# Set ownership
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port (Cloud Run uses PORT env variable)
EXPOSE 8080

# Set environment
ENV NODE_ENV=production
ENV PORT=8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/health || exit 1

# Start the application
CMD ["node", "dist/server.js"]
