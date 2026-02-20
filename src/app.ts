import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import jwt from 'jsonwebtoken';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';

import { config } from './config';
import { morganStream } from './utils/logger';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';
import { apiLimiter } from './middlewares/rateLimiter';

// Import routes
import routes from './routes';

// Import GraphQL schema
import { schema } from './graphql';

interface MyContext {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

// CORS options to reuse
const corsOptions = {
  origin: config.corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

export const createApp = async (): Promise<Application> => {
  const app = express();

  // ===================
  // Security Middlewares
  // ===================

  // Helmet - Security headers (disable for GraphQL playground)
  app.use(
    helmet({
      contentSecurityPolicy: config.isProduction ? undefined : false,
      crossOriginEmbedderPolicy: false,
    })
  );

  // CORS for REST API
  app.use(cors(corsOptions));

  // Rate limiting for REST API only
  app.use('/api', apiLimiter);

  // ===================
  // Parsing Middlewares
  // ===================

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(cookieParser());

  // ===================
  // Compression
  // ===================

  app.use(compression());

  // ===================
  // Logging
  // ===================

  if (!config.isProduction) {
    app.use(morgan('dev'));
  } else {
    app.use(morgan('combined', { stream: morganStream }));
  }

  // ===================
  // Static Files
  // ===================

  app.use('/uploads', express.static('uploads'));

  // ===================
  // Health Check
  // ===================

  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // ===================
  // REST API Routes
  // ===================

  app.use(`/api/${config.apiVersion}`, routes);

  // ===================
  // GraphQL Setup
  // ===================

  const apolloServer = new ApolloServer<MyContext>({
    schema,
    introspection: !config.isProduction,
  });

  await apolloServer.start();

  // Apollo Server 4 requires cors and json middleware at route level
  app.use(
    '/graphql',
    cors<cors.CorsRequest>(corsOptions) as express.RequestHandler,
    express.json({ limit: '10mb' }),
    // Ensure req.body exists (express.json doesn't set it for GET requests)
    ((req, _res, next) => {
      req.body = req.body || {};
      next();
    }) as express.RequestHandler,
    expressMiddleware(apolloServer, {
      context: async ({ req }): Promise<MyContext> => {
        // Extract token from Authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
          return {};
        }

        const token = authHeader.split(' ')[1];
        if (!token) {
          return {};
        }

        try {
          // Verify JWT and extract user
          const decoded = jwt.verify(token, config.jwt.secret) as {
            id: string;
            email: string;
            role: string;
          };

          return {
            user: {
              id: decoded.id,
              email: decoded.email,
              role: decoded.role,
            },
          };
        } catch {
          // Invalid token - return empty context
          return {};
        }
      },
    }) as unknown as express.RequestHandler
  );

  // ===================
  // Error Handling
  // ===================

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
