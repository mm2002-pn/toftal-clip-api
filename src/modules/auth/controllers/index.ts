import { Request, Response, NextFunction } from 'express';
import * as authService from '../services';
import { ApiResponse } from '../../../utils/apiResponse';
import { config } from '../../../config';

// Cookie options
const cookieOptions = {
  httpOnly: true,
  secure: config.isProduction,
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

// Register
export const register = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password, name, role } = req.body;
    const result = await authService.register({ email, password, name, role });

    // Set refresh token in cookie
    res.cookie('refreshToken', result.tokens.refreshToken, cookieOptions);

    ApiResponse.created(res, {
      user: result.user,
      accessToken: result.tokens.accessToken,
    }, 'Registration successful');
  } catch (error) {
    next(error);
  }
};

// Login
export const login = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password } = req.body;
    const result = await authService.login({ email, password });

    // Set refresh token in cookie
    res.cookie('refreshToken', result.tokens.refreshToken, cookieOptions);

    ApiResponse.success(res, {
      user: result.user,
      accessToken: result.tokens.accessToken,
    }, 'Login successful');
  } catch (error) {
    next(error);
  }
};

// Logout
export const logout = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Clear refresh token cookie
    res.clearCookie('refreshToken', cookieOptions);

    ApiResponse.success(res, null, 'Logout successful');
  } catch (error) {
    next(error);
  }
};

// Refresh token
export const refreshToken = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

    if (!refreshToken) {
      return ApiResponse.unauthorized(res, 'Refresh token required') as any;
    }

    const tokens = await authService.refreshAccessToken(refreshToken);

    // Set new refresh token in cookie
    res.cookie('refreshToken', tokens.refreshToken, cookieOptions);

    ApiResponse.success(res, {
      accessToken: tokens.accessToken,
    }, 'Token refreshed successfully');
  } catch (error) {
    next(error);
  }
};

// Get current user
export const getMe = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const user = await authService.getCurrentUser(req.user!.id);

    ApiResponse.success(res, user);
  } catch (error) {
    next(error);
  }
};

// Change password
export const changePassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body;

    await authService.changePassword(req.user!.id, currentPassword, newPassword);

    ApiResponse.success(res, null, 'Password changed successfully');
  } catch (error) {
    next(error);
  }
};
