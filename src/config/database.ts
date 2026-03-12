import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger';

declare global {
  var prisma: PrismaClient | undefined;
}

// Add connection pooling parameters to DATABASE_URL if not present
const getDatabaseUrl = () => {
  const url = process.env.DATABASE_URL || '';
  // Add connection_limit if not already present
  if (url && !url.includes('connection_limit')) {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}connection_limit=5&pool_timeout=10`;
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
    logger.info('Database connected successfully');
  } catch (error) {
    logger.error('Database connection failed:', error);
    process.exit(1);
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  await prisma.$disconnect();
  logger.info('Database disconnected');
};
