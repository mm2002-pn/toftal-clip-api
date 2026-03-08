import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import * as betaSignupService from '../services';
import { ApiResponse } from '../../../utils/apiResponse';

// Simple validators
const validateEmail = (email: string): boolean => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

// Simple sanitization - remove leading/trailing whitespace
const sanitizeInput = (input: string): string => {
  return input.trim().replace(/[<>]/g, '');
};

/**
 * POST /api/v1/beta-signups
 * Create a new beta signup
 */
export const createBetaSignup = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const {
      name,
      email,
      contact,
      role,
      videoCount,
      collaboration,
      biggestProblem,
      interests,
      feedbackReady,
      link,
      marketplaceInterest,
      source,
    } = req.body;

    // ============ VALIDATION ============
    // Required fields
    if (!name || !email || !contact) {
      ApiResponse.badRequest(res, 'Name, email, and contact are required');
      return;
    }

    // Validate email format
    if (!validateEmail(email)) {
      ApiResponse.badRequest(res, 'Invalid email format');
      return;
    }

    // Validate name length
    if (name.trim().length < 2 || name.trim().length > 100) {
      ApiResponse.badRequest(res, 'Name must be between 2 and 100 characters');
      return;
    }

    // Validate contact (email or phone)
    const isEmailContact = validateEmail(contact);
    const isPhoneContact = /^[\+\d\s\-\(\)]{10,}$/.test(contact.trim());
    if (!isEmailContact && !isPhoneContact) {
      ApiResponse.badRequest(res, 'Contact must be a valid email or phone number');
      return;
    }

    // Validate interests array if provided
    if (interests && !Array.isArray(interests)) {
      ApiResponse.badRequest(res, 'Interests must be an array');
      return;
    }

    // ============ SANITIZATION ============
    const interestsSanitized: string[] = interests?.map((i: string) => sanitizeInput(i)) || [];

    const sanitizedData = {
      name: sanitizeInput(name),
      email: email.toLowerCase().trim(),
      contact: sanitizeInput(contact),
      role: role ? sanitizeInput(role) : undefined,
      videoCount: videoCount ? sanitizeInput(videoCount) : undefined,
      collaboration: collaboration ? sanitizeInput(collaboration) : undefined,
      biggestProblem: biggestProblem ? sanitizeInput(biggestProblem) : undefined,
      interests: interestsSanitized,
      feedbackReady: feedbackReady ? sanitizeInput(feedbackReady) : undefined,
      link: link ? sanitizeInput(link) : undefined,
      marketplaceInterest: marketplaceInterest ? sanitizeInput(marketplaceInterest) : undefined,
      source: source ? sanitizeInput(source) : undefined,
      ipAddress: req.ip || undefined,
      userAgent: req.get('user-agent') || undefined,
    };

    // ============ CREATE SIGNUP ============
    const signup = await betaSignupService.createBetaSignup(sanitizedData);

    ApiResponse.created(
      res,
      {
        id: signup.id,
        email: signup.email,
        name: signup.name,
        createdAt: signup.createdAt,
      },
      'Beta signup successful! We will contact you soon.'
    );
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Email already registered')) {
        ApiResponse.conflict(res, error.message);
        return;
      }
    }
    next(error);
  }
};

/**
 * GET /api/v1/beta-signups (ADMIN ONLY)
 * Get all beta signups
 */
export const getAllBetaSignups = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Verify admin role
    if ((req as any).user?.role !== 'ADMIN') {
      ApiResponse.forbidden(res, 'Only admins can access this endpoint');
      return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = (req.query.status as string) || undefined;

    // Validate pagination
    if (page < 1 || limit < 1 || limit > 100) {
      ApiResponse.badRequest(res, 'Invalid pagination parameters');
      return;
    }

    const skip = (page - 1) * limit;
    const result = await betaSignupService.getAllBetaSignups(skip, limit, status);

    ApiResponse.success(res, result, 'Beta signups retrieved successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/v1/beta-signups/:id (ADMIN ONLY)
 * Get a single beta signup
 */
export const getBetaSignup = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Verify admin role
    if ((req as any).user?.role !== 'ADMIN') {
      ApiResponse.forbidden(res, 'Only admins can access this endpoint');
      return;
    }

    const id = req.params.id as string;

    const signup = await betaSignupService.getBetaSignup(id);

    if (!signup) {
      ApiResponse.notFound(res, 'Beta signup not found');
      return;
    }

    ApiResponse.success(res, signup);
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/v1/beta-signups/:id/status (ADMIN ONLY)
 * Update beta signup status
 */
export const updateBetaSignupStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Verify admin role
    if ((req as any).user?.role !== 'ADMIN') {
      ApiResponse.forbidden(res, 'Only admins can access this endpoint');
      return;
    }

    const id = req.params.id as string;
    const { status, notes } = req.body;

    // Validate status type
    if (typeof status !== 'string') {
      ApiResponse.badRequest(res, 'Status must be a string');
      return;
    }

    // Validate status
    const validStatuses = ['PENDING', 'VERIFIED', 'CONTACTED', 'REJECTED'];
    if (!status || !validStatuses.includes(status)) {
      ApiResponse.badRequest(res, `Status must be one of: ${validStatuses.join(', ')}`);
      return;
    }

    const notesSanitized = typeof notes === 'string' ? sanitizeInput(notes) : undefined;

    const signup = await betaSignupService.updateBetaSignupStatus(
      id,
      status,
      notesSanitized
    );

    ApiResponse.success(res, signup, 'Status updated successfully');
  } catch (error) {
    if (error instanceof Error && error.message.includes('Record to update not found')) {
      ApiResponse.notFound(res, 'Beta signup not found');
      return;
    }
    next(error);
  }
};

/**
 * DELETE /api/v1/beta-signups/:id (ADMIN ONLY)
 * Delete a beta signup
 */
export const deleteBetaSignup = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Verify admin role
    if ((req as any).user?.role !== 'ADMIN') {
      ApiResponse.forbidden(res, 'Only admins can access this endpoint');
      return;
    }

    const id = req.params.id as string;

    await betaSignupService.deleteBetaSignup(id);

    ApiResponse.success(res, null, 'Beta signup deleted successfully');
  } catch (error) {
    if (error instanceof Error && error.message.includes('Record to delete not found')) {
      ApiResponse.notFound(res, 'Beta signup not found');
      return;
    }
    next(error);
  }
};
