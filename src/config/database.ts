import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

declare global {
  var prisma: PrismaClient | undefined;
}

// Add connection pooling parameters to DATABASE_URL if not present
const getDatabaseUrl = () => {
  const url = process.env.DATABASE_URL || '';

  // ✅ Configuration pool de connexions optimisée pour db-f1-micro
  // db-f1-micro max: 25 connexions | max-instances: 5 | pool: 3 = 15 connexions max
  const connectionLimit = process.env.DB_CONNECTION_LIMIT || '3';   // RÉDUIT: 3 connexions par instance
  const poolTimeout = process.env.DB_POOL_TIMEOUT || '20';          // 20s timeout pour obtenir connexion
  const connectTimeout = '10';  // 10s timeout pour établir connexion initiale

  // Add connection parameters
  if (url && !url.includes('connection_limit')) {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}connection_limit=${connectionLimit}&pool_timeout=${poolTimeout}&connect_timeout=${connectTimeout}`;
  }
  return url;
};

export const prisma = global.prisma || new PrismaClient({
  log: [
    { level: 'query', emit: 'event' },
    { level: 'error', emit: 'stdout' },
    { level: 'warn', emit: 'stdout' },
  ],
  datasources: {
    db: {
      url: getDatabaseUrl(),
    },
  },
});

// Always use singleton in production to prevent connection leaks
if (process.env.NODE_ENV === 'production') {
  global.prisma = prisma;
} else {
  global.prisma = prisma;
}

export const connectDatabase = async (): Promise<void> => {
  try {
    await prisma.$connect();

    // Log connection pool settings
    const connectionLimit = process.env.DB_CONNECTION_LIMIT || '3';
    const poolTimeout = process.env.DB_POOL_TIMEOUT || '20';
    logger.info(`Database connected successfully (pool: ${connectionLimit} connections, timeout: ${poolTimeout}s)`);
  } catch (error) {
    logger.error('Database connection failed:', error);
    process.exit(1);
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  await prisma.$disconnect();
  logger.info('Database disconnected');
};
