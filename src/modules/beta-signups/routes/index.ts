import { Router, Request, Response, NextFunction } from 'express';
import * as betaSignupController from '../controllers';
import { rateLimit } from 'express-rate-limit';
import { authenticate } from '../../../middlewares/auth';

const router = Router();

/**
 * Rate limiting for beta signup endpoint
 * 50 requests per 15 minutes per IP (development)
 * In production, reduce to 5 requests per 15 minutes
 */
const betaSignupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Development: 50 requests, Production: 5 requests
  message: 'Too many signup attempts, please try again later',
  standardHeaders: true, // Return rate limit info in RateLimit-* headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
  skip: (req) => {
    // Skip rate limiting for admin users
    return (req as any).user?.role === 'ADMIN';
  },
});

/**
 * Rate limiting for admin endpoints
 * 100 requests per 15 minutes
 */
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * POST /api/v1/beta-signups
 * Create a new beta signup
 * Public endpoint with rate limiting
 */
router.post(
  '/',
  betaSignupLimiter,
  (req: Request, res: Response, next: NextFunction) => {
    betaSignupController.createBetaSignup(req, res, next);
  }
);

/**
 * GET /api/v1/beta-signups
 * Get all beta signups (admin only)
 * Query params: page=1, limit=20, status=PENDING
 */
router.get(
  '/',
  authenticate,
  adminLimiter,
  (req: Request, res: Response, next: NextFunction) => {
    betaSignupController.getAllBetaSignups(req, res, next);
  }
);

/**
 * GET /api/v1/beta-signups/:id
 * Get a single beta signup (admin only)
 */
router.get(
  '/:id',
  authenticate,
  adminLimiter,
  (req: Request, res: Response, next: NextFunction) => {
    betaSignupController.getBetaSignup(req, res, next);
  }
);

/**
 * PATCH /api/v1/beta-signups/:id/status
 * Update beta signup status (admin only)
 * Body: { status: string, notes?: string }
 */
router.patch(
  '/:id/status',
  authenticate,
  adminLimiter,
  (req: Request, res: Response, next: NextFunction) => {
    betaSignupController.updateBetaSignupStatus(req, res, next);
  }
);

/**
 * DELETE /api/v1/beta-signups/:id
 * Delete a beta signup (admin only)
 */
router.delete(
  '/:id',
  authenticate,
  adminLimiter,
  (req: Request, res: Response, next: NextFunction) => {
    betaSignupController.deleteBetaSignup(req, res, next);
  }
);

export default router;
