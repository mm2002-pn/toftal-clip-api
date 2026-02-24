import { createServer } from 'http';
import { createApp } from './app';
import { config } from './config';
import { connectDatabase, disconnectDatabase } from './config/database';
import { logger } from './utils/logger';
import { socketService } from './services/socketService';

const startServer = async (): Promise<void> => {
  try {
    // Connect to database
    await connectDatabase();

    // Create Express app
    const app = await createApp();

    // Create HTTP server for Socket.io
    const httpServer = createServer(app);

    // Initialize Socket.io
    socketService.initialize(httpServer);

    // Start server
    const server = httpServer.listen(config.port, () => {
      logger.info(`
========================================
  Server started successfully!
========================================
  Environment: ${config.nodeEnv}
  Port: ${config.port}

  REST API: http://localhost:${config.port}/api/${config.apiVersion}
  GraphQL:  http://localhost:${config.port}/graphql
  WebSocket: ws://localhost:${config.port}
  Health:   http://localhost:${config.port}/health
========================================
      `);
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal: string): Promise<void> => {
      logger.info(`${signal} signal received. Starting graceful shutdown...`);

      server.close(async () => {
        logger.info('HTTP server closed');
        await disconnectDatabase();
        logger.info('Database connection closed');
        process.exit(0);
      });

      // Force close after 30 seconds
      setTimeout(() => {
        logger.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
      }, 30000);
    };

    // Handle shutdown signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      logger.error('Uncaught Exception:', error);
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason: any) => {
      logger.error('Unhandled Rejection:', reason);
      process.exit(1);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
