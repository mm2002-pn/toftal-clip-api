import rateLimit from 'express-rate-limit';
import { config } from '../config';
import { ApiResponse } from '../utils/apiResponse';

// General API rate limiter
export const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs, // 15 minutes
  max: config.isProduction ? config.rateLimit.max : 10000, // 100 in production, unlimited in development
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for health checks and in development
  skip: (req) => req.path === '/health' || !config.isProduction,
  handler: (req, res) => {
    ApiResponse.tooManyRequests(res, 'Too many requests from this IP, please try again later.');
  },
});

// Strict rate limiter for auth routes
export const authLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs, // 15 minutes
  max: config.isProduction ? config.rateLimit.max : 10000, // Use config in production, unlimited in development
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !config.isProduction, // Skip in development
  handler: (req, res) => {
    ApiResponse.tooManyRequests(
      res,
      'Too many authentication attempts, please try again later.'
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
