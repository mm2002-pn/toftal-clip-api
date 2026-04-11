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

# Install OpenSSL, FFmpeg, wget, and PgBouncer for connection pooling
RUN apt-get update && apt-get install -y openssl ffmpeg wget pgbouncer && rm -rf /var/lib/apt/lists/*

# Create pgbouncer user and directories
RUN useradd -r -s /bin/false pgbouncer && \
    mkdir -p /etc/pgbouncer /var/run/pgbouncer /var/log/pgbouncer && \
    chown -R pgbouncer:pgbouncer /var/run/pgbouncer /var/log/pgbouncer

# Create PgBouncer config (transaction pooling mode)
RUN echo '[databases]\n\
* = host=/cloudsql/toftal-clip-api:europe-west1:toftal-clip-db\n\
\n\
[pgbouncer]\n\
listen_addr = 127.0.0.1\n\
listen_port = 6432\n\
auth_type = trust\n\
auth_file = /etc/pgbouncer/userlist.txt\n\
pool_mode = transaction\n\
max_client_conn = 500\n\
default_pool_size = 10\n\
min_pool_size = 2\n\
reserve_pool_size = 5\n\
server_idle_timeout = 10\n\
client_idle_timeout = 300\n\
query_timeout = 120\n\
query_wait_timeout = 30\n\
server_lifetime = 1800\n\
server_check_query = SELECT 1\n\
server_check_delay = 30\n\
log_connections = 0\n\
log_disconnections = 0\n\
log_pooler_errors = 0\n\
verbose = 0\n\
admin_users = postgres\n\
ignore_startup_parameters = extra_float_digits\n\
pidfile = /var/run/pgbouncer/pgbouncer.pid\n\
logfile = /var/log/pgbouncer/pgbouncer.log\n' > /etc/pgbouncer/pgbouncer.ini && \
    chown pgbouncer:pgbouncer /etc/pgbouncer/pgbouncer.ini

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy Prisma schema and generate client
COPY prisma ./prisma/
RUN npx prisma generate

# Copy built application
COPY --from=builder /app/dist ./dist

# Create startup script
RUN echo '#!/bin/bash\n\
set -e\n\
\n\
# Create PgBouncer userlist from DATABASE_URL\n\
DB_USER=$(echo $DATABASE_URL | sed -n "s|.*://\\([^:]*\\):.*|\\1|p")\n\
DB_PASS=$(echo $DATABASE_URL | sed -n "s|.*://[^:]*:\\([^@]*\\)@.*|\\1|p")\n\
echo "\"$DB_USER\" \"$DB_PASS\"" > /etc/pgbouncer/userlist.txt\n\
chmod 600 /etc/pgbouncer/userlist.txt\n\
\n\
# Update DATABASE_URL to point to PgBouncer\n\
export DATABASE_URL_ORIGINAL=$DATABASE_URL\n\
# Extract database name from URL (format: ...@host/dbname?...)\n\
DB_NAME=$(echo $DATABASE_URL | sed -n "s|.*@[^/]*/\\([^?]*\\).*|\\1|p")\n\
export DATABASE_URL="postgresql://$DB_USER:$DB_PASS@127.0.0.1:6432/$DB_NAME?pgbouncer=true"\n\
echo "[startup] PgBouncer URL: $DATABASE_URL"\n\
\n\
# Start PgBouncer in background as pgbouncer user\n\
echo "[startup] Starting PgBouncer..."\n\
chown pgbouncer:pgbouncer /etc/pgbouncer/userlist.txt\n\
su -s /bin/bash pgbouncer -c "pgbouncer -d /etc/pgbouncer/pgbouncer.ini"\n\
sleep 2\n\
\n\
# Start Node.js app\n\
echo "[startup] Starting Node.js..."\n\
exec node dist/server.js\n' > /app/start.sh && chmod +x /app/start.sh

# Create uploads directory
RUN mkdir -p uploads

# Expose port (Cloud Run uses PORT env variable)
EXPOSE 8080

# Set environment
ENV NODE_ENV=production
ENV PORT=8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/health || exit 1

# Start with PgBouncer + Node
CMD ["/app/start.sh"]
