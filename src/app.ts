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
import { cacheService } from './services/cacheService';

// Import routes
import routes from './routes';

// Import GraphQL schema
import { schema } from './graphql';
import { createDataLoaders, DataLoaders } from './graphql/dataloaders';

interface MyContext {
  user?: {
    id: string;
    email: string;
    role: string;
  };
  // Set when the request carried a valid X-Share-Token header. The presence
  // of this field is what lets ACL helpers (assertProjectReadAccess etc.)
  // grant read access to a deliverable that the authenticated user isn't a
  // member of — they hold a valid share link instead.
  share?: {
    deliverableId: string;
    projectId: string;
    permission: string; // "view" | "comment" | "download"
  };
  loaders: DataLoaders;
}

// CORS options to reuse
const corsOptions = {
  origin: config.corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    // Share-link auth: GraphQL requests from /share/video/<token> pages
    // include this so the resolver can grant read access to non-members.
    'X-Share-Token',
    // Sentry distributed tracing: the JS SDK adds these to every outgoing
    // fetch so backend spans can be stitched to the frontend transaction.
    // Without them in the CORS preflight allow-list, prod blocks every
    // request from toftalclip.io to api.toftalclip.io.
    'sentry-trace',
    'baggage',
    // TUS protocol headers
    'Tus-Resumable',
    'Upload-Length',
    'Upload-Offset',
    'Upload-Metadata',
    'Upload-Concat',
    'Upload-Defer-Length',
    'X-HTTP-Method-Override',
    'X-Tus-Token',
  ],
  exposedHeaders: [
    // TUS protocol response headers
    'Upload-Offset',
    'Upload-Length',
    'Tus-Version',
    'Tus-Resumable',
    'Tus-Max-Size',
    'Tus-Extension',
    'Upload-Metadata',
    'Location',
    'X-Final-Url',
    'X-Version-Id',
    'X-Video-Url',
  ],
};

export const createApp = async (): Promise<Application> => {
  const app = express();

  // ===================
  // Trust Proxy (Required for Cloud Run)
  // ===================

  // CRITICAL: Enable trust proxy for Cloud Run reverse proxy
  // This allows Express to correctly read X-Forwarded-* headers
  // Only enable in production to avoid rate limiter warnings in development
  if (config.isProduction) {
    app.set('trust proxy', true);
  }

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

  // Rate limiting for REST API only (skip TUS - many requests are normal)
  app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/v1/tus')) {
      return next();
    }
    apiLimiter(req, res, next);
  });

  // ===================
  // Parsing Middlewares
  // ===================

  // Skip body parsing for TUS uploads (TUS handles its own body parsing)
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/v1/tus') && req.method !== 'GET') {
      return next();
    }
    express.json({ limit: '50mb' })(req, res, next);
  });

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/v1/tus') && req.method !== 'GET') {
      return next();
    }
    express.urlencoded({ extended: true, limit: '50mb' })(req, res, next);
  });

  app.use(cookieParser());

  // ===================
  // Compression
  // ===================

  // Skip compression for TUS uploads (binary data)
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/v1/tus')) {
      return next();
    }
    compression()(req, res, next);
  });

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

  app.get('/health', async (req, res) => {
    const redisStatus = await cacheService.healthCheck();
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      cache: {
        enabled: cacheService.isEnabled(),
        connected: redisStatus,
      },
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
    express.json({ limit: '50mb' }),
    // Ensure req.body exists (express.json doesn't set it for GET requests)
    ((req, _res, next) => {
      req.body = req.body || {};
      next();
    }) as express.RequestHandler,
    expressMiddleware(apolloServer, {
      context: async ({ req }): Promise<MyContext> => {
        // ✅ PHASE 2: Créer les DataLoaders pour chaque requête
        // IMPORTANT: Les loaders doivent être créés par requête pour éviter
        // le cache entre requêtes et les problèmes de permissions
        const loaders = createDataLoaders();

        // Resolve the share-link side first — it's independent of (and may
        // accompany) the JWT. Used by /share/video/<token> pages where the
        // viewer is authenticated but isn't a member of the project: the
        // share-link grants them read access to one specific deliverable.
        let share: MyContext['share'] | undefined;
        const shareTokenHeader = req.headers['x-share-token'];
        const shareTokenRaw = Array.isArray(shareTokenHeader)
          ? shareTokenHeader[0]
          : shareTokenHeader;
        if (typeof shareTokenRaw === 'string' && shareTokenRaw.length > 0) {
          try {
            const { prisma } = await import('./config/database');
            const link = await prisma.deliverableShareLink.findUnique({
              where: { token: shareTokenRaw },
              select: {
                deliverableId: true,
                isActive: true,
                expiresAt: true,
                permission: true,
                deliverable: { select: { projectId: true } },
              },
            });
            const stillValid =
              !!link &&
              link.isActive &&
              (!link.expiresAt || link.expiresAt > new Date());
            if (stillValid) {
              share = {
                deliverableId: link!.deliverableId,
                projectId: link!.deliverable.projectId,
                permission: link!.permission,
              };
            }
          } catch {
            // Don't fail the whole request on a malformed share token —
            // fall through to JWT-only auth.
          }
        }

        // Extract token from Authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
          return { loaders, share };
        }

        const token = authHeader.split(' ')[1];
        if (!token) {
          return { loaders, share };
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
            loaders,
            share,
          };
        } catch {
          // Invalid token - return empty context with loaders + share
          return { loaders, share };
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
