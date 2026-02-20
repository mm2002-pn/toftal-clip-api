import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { ApiResponse } from '../utils/apiResponse';
import { logger } from '../utils/logger';
import { config } from '../config';

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): Response => {
  // Log error
  logger.error(`${err.message}`, {
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  // Handle known operational errors
  if (err instanceof AppError) {
    return ApiResponse.error(res, err.message, err.statusCode, err.errors);
  }

  // Handle Prisma errors
  if (err.name === 'PrismaClientKnownRequestError') {
    const prismaError = err as any;

    switch (prismaError.code) {
      case 'P2002':
        return ApiResponse.conflict(res, 'A record with this value already exists');
      case 'P2025':
        return ApiResponse.notFound(res, 'Record not found');
      case 'P2003':
        return ApiResponse.badRequest(res, 'Foreign key constraint failed');
      default:
        return ApiResponse.badRequest(res, 'Database operation failed');
    }
  }

  // Handle validation errors
  if (err.name === 'ValidationError') {
    return ApiResponse.validationError(res, [{ message: err.message }]);
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    return ApiResponse.unauthorized(res, 'Invalid token');
  }

  if (err.name === 'TokenExpiredError') {
    return ApiResponse.unauthorized(res, 'Token expired');
  }

  // Handle multer errors
  if (err.name === 'MulterError') {
    const multerError = err as any;

    switch (multerError.code) {
      case 'LIMIT_FILE_SIZE':
        return ApiResponse.badRequest(res, 'File size too large');
      case 'LIMIT_FILE_COUNT':
        return ApiResponse.badRequest(res, 'Too many files');
      case 'LIMIT_UNEXPECTED_FILE':
        return ApiResponse.badRequest(res, 'Unexpected file field');
      default:
        return ApiResponse.badRequest(res, 'File upload error');
    }
  }

  // Default server error
  const message = config.isProduction ? 'Internal server error' : err.message;
  return ApiResponse.serverError(res, message);
};

// 404 handler
export const notFoundHandler = (req: Request, res: Response): Response => {
  return ApiResponse.notFound(res, `Route ${req.method} ${req.path} not found`);
};
