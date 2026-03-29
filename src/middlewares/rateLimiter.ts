import rateLimit from 'express-rate-limit';
import { config } from '../config';
import { ApiResponse } from '../utils/apiResponse';

// General API rate limiter
export const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs, // 15 minutes
  max: config.isProduction ? config.rateLimit.max : 10000,
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const user = (req as any).user;
    const identifier = user?.email || req.ip;
    ApiResponse.tooManyRequests(res, `Too many requests for ${identifier}, please try again later.`);
  },
});

// Strict rate limiter for auth routes
export const authLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs, // 15 minutes
  max: config.isProduction ? config.rateLimit.max : 10000,
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const email = req.body?.email || req.ip;
    ApiResponse.tooManyRequests(
      res,
      `Too many authentication attempts for ${email}, please try again later.`
    );
  },
});

// Upload rate limiter
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // 50 uploads per hour
  message: 'Too many uploads, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    ApiResponse.tooManyRequests(res, 'Too many uploads, please try again later.');
  },
});

// AI routes rate limiter (expensive operations)
export const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 AI requests per minute
  message: 'Too many AI requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    ApiResponse.tooManyRequests(res, 'Too many AI requests, please try again later.');
  },
});
