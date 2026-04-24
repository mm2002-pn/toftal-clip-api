import rateLimit from 'express-rate-limit';
import { config } from '../config';
import { ApiResponse } from '../utils/apiResponse';

// General API rate limiter. The dev cap (2000/15min) used to be 10 000 which
// effectively disabled it — lowered so we actually see the limiter trip
// during local testing too.
export const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs, // 15 minutes
  max: config.isProduction ? config.rateLimit.max : 2000,
  message: 'Trop de requêtes, réessayez plus tard.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    const user = (req as any).user;
    const identifier = user?.email || req.ip;
    ApiResponse.tooManyRequests(res, `Trop de requêtes pour ${identifier}, réessayez plus tard.`);
  },
});

// Auth routes other than /login: register, forgot-password, verify-otp,
// reset-password, google, resend-verification. Keeps bulk abuse in check but
// tolerates legitimate retries.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.isProduction ? 30 : 100,
  message: 'Trop de tentatives, réessayez plus tard.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    ApiResponse.tooManyRequests(res, 'Trop de tentatives, réessayez dans 15 minutes.');
  },
});

// Brute-force guard for /login + /google. Only FAILED attempts are counted
// (skipSuccessfulRequests), keyed by IP + email so one attacker can't share
// the quota across victims. Hits the limit → 429 with a clear FR message.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: config.isProduction ? 10 : 15, // 10 failed attempts → block
  message: 'Trop de tentatives de connexion. Réessayez plus tard.',
  standardHeaders: true,
  legacyHeaders: false,
  // Don't count successful logins — a busy legitimate user shouldn't get
  // blocked. Only wrong-password / wrong-email (4xx/5xx) bump the counter.
  skipSuccessfulRequests: true,
  // Key by IP + email so attacking two accounts doesn't exhaust a shared
  // counter, and one compromised network can't lock everyone out.
  keyGenerator: (req) => {
    const email = String(req.body?.email || '').toLowerCase().trim();
    const ip = req.ip || 'unknown';
    return `${ip}:${email}`;
  },
  handler: (_req, res) => {
    ApiResponse.tooManyRequests(
      res,
      'Trop de tentatives de connexion échouées. Réessayez dans 15 minutes ou réinitialisez votre mot de passe.'
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
