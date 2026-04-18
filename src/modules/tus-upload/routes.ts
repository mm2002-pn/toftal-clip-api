/**
 * TUS Upload Routes
 *
 * Handles resumable uploads using the TUS protocol.
 * All video uploads should use these endpoints for reliability.
 *
 * Endpoints:
 * - POST   /api/v1/tus           - Create new upload
 * - HEAD   /api/v1/tus/:id       - Get upload status
 * - PATCH  /api/v1/tus/:id       - Upload chunk
 * - DELETE /api/v1/tus/:id       - Cancel upload
 * - GET    /api/v1/tus/progress/:id - Get upload progress (custom)
 */

import { Router, Request, Response, NextFunction } from 'express';
import { createTusServer, getUploadProgress, TUS_CONFIG } from '../../config/tus';
import { authenticate } from '../../middlewares/auth';
import jwt from 'jsonwebtoken';
import { config } from '../../config';

const router = Router();

// Create TUS server instance
const tusServer = createTusServer();

/**
 * Middleware to extract user from JWT and add to request
 * TUS protocol requires custom auth handling
 */
const tusAuthMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];

      try {
        const decoded = jwt.verify(token, config.jwt.secret) as {
          id: string;
          email: string;
          role: string;
        };

        (req as any).user = {
          id: decoded.id,
          email: decoded.email,
          role: decoded.role,
        };
      } catch (error) {
        // Token invalid but continue - TUS server will handle auth
      }
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Custom endpoint: Get upload progress
 * GET /api/v1/tus/progress/:id
 */
router.get('/progress/:id', authenticate, async (req: Request, res: Response) => {
  try {
    const uploadId = String(req.params.id);

    const progress = await getUploadProgress(uploadId);

    if (!progress) {
      return res.status(404).json({
        success: false,
        error: 'Upload not found',
      });
    }

    res.json({
      success: true,
      data: progress,
    });
  } catch (error: any) {
    console.error('Get progress error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get upload progress',
    });
  }
});

/**
 * Custom endpoint: Get TUS configuration
 * GET /api/v1/tus/config
 */
router.get('/config', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      maxSize: TUS_CONFIG.maxSize,
      maxSizeFormatted: `${TUS_CONFIG.maxSize / (1024 * 1024 * 1024)}GB`,
      chunkSize: TUS_CONFIG.chunkSize,
      chunkSizeFormatted: `${TUS_CONFIG.chunkSize / (1024 * 1024)}MB`,
      expirationHours: TUS_CONFIG.expirationPeriodInMilliseconds / (1000 * 60 * 60),
      endpoint: TUS_CONFIG.path,
      extensions: ['creation', 'creation-with-upload', 'termination', 'expiration'],
    },
  });
});

/**
 * TUS Protocol Handler
 * Handles: POST, HEAD, PATCH, DELETE, OPTIONS
 */
router.all('*', tusAuthMiddleware, (req: Request, res: Response) => {
  // Set CORS headers for TUS
  const origin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, HEAD, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', [
    'Authorization',
    'X-Tus-Token',
    'Upload-Length',
    'Upload-Offset',
    'Tus-Resumable',
    'Upload-Metadata',
    'Upload-Concat',
    'Upload-Defer-Length',
    'X-Requested-With',
    'X-HTTP-Method-Override',
    'Content-Type',
  ].join(', '));
  res.setHeader('Access-Control-Expose-Headers', [
    'Upload-Offset',
    'Location',
    'Upload-Length',
    'Tus-Version',
    'Tus-Resumable',
    'Tus-Max-Size',
    'Tus-Extension',
    'Upload-Metadata',
    'Upload-Checksum',
    'X-Final-Url',
    'X-Version-Id',
    'X-Video-Url',
  ].join(', '));
  res.setHeader('Access-Control-Max-Age', '86400');

  // Handle OPTIONS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Tus-Resumable', '1.0.0');
    res.setHeader('Tus-Version', '1.0.0');
    res.setHeader('Tus-Max-Size', String(TUS_CONFIG.maxSize));
    res.setHeader('Tus-Extension', 'creation,creation-with-upload,termination,expiration');
    return res.status(204).end();
  }

  // Handle TUS request
  tusServer.handle(req, res);
});

export default router;
