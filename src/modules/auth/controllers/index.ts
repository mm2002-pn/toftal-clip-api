import { Request, Response, NextFunction } from 'express';
import * as authService from '../services';
import { ApiResponse } from '../../../utils/apiResponse';
import { config } from '../../../config';

// Cookie options - handle cross-origin in production
const cookieOptions = {
  httpOnly: true,
  secure: config.isProduction, // true in production (HTTPS)
  sameSite: config.isProduction ? 'none' as const : 'lax' as const, // 'none' for cross-origin in production
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days for refresh token
  path: '/',
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

    // Set refresh token in cookie if tokens exist
    if (result.tokens) {
      res.cookie('refreshToken', result.tokens.refreshToken, cookieOptions);
    }

    const message = result.emailSent
      ? 'Inscription réussie ! Vérifiez votre email pour activer votre compte.'
      : 'Inscription réussie mais l\'email de vérification n\'a pas pu être envoyé. Utilisez "Renvoyer l\'email" sur la page de connexion.';

    ApiResponse.created(res, {
      user: result.user,
      accessToken: result.tokens?.accessToken || null,
      emailSent: result.emailSent,
    }, message);
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

    // Set refresh token in cookie if tokens exist
    if (result.tokens) {
      res.cookie('refreshToken', result.tokens.refreshToken, cookieOptions);
    }

    ApiResponse.success(res, {
      user: result.user,
      accessToken: result.tokens?.accessToken || null,
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
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

    if (!refreshToken) {
      return ApiResponse.unauthorized(res, 'Refresh token required') as any;
    }

    const tokens = await authService.refreshAccessToken(refreshToken);

    if (!tokens || !tokens.refreshToken) {
      return ApiResponse.serverError(res, 'Failed to generate tokens') as any;
    }

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

// Login/Register with Google
export const googleAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { idToken, role, createIfNotExists } = req.body;
    const result = await authService.loginWithGoogle({ idToken, role, createIfNotExists });

    // Set refresh token in cookie if tokens exist
    if (result.tokens) {
      res.cookie('refreshToken', result.tokens.refreshToken, cookieOptions);
    }

    ApiResponse.success(res, {
      user: result.user,
      accessToken: result.tokens?.accessToken || null,
    }, 'Google authentication successful');
  } catch (error) {
    next(error);
  }
};

// Verify email
export const verifyEmail = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { token } = req.body;
    const result = await authService.verifyEmail(token);

    ApiResponse.success(res, result);
  } catch (error) {
    next(error);
  }
};

// Resend verification email
export const resendVerification = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email } = req.body;
    const result = await authService.resendVerificationEmail(email);

    ApiResponse.success(res, result);
  } catch (error) {
    next(error);
  }
};

// Forgot password - send OTP
export const forgotPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email } = req.body;
    const result = await authService.forgotPassword(email);

    ApiResponse.success(res, result, 'OTP sent if email exists');
  } catch (error) {
    next(error);
  }
};

// Verify OTP
export const verifyOtp = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, otp } = req.body;
    const result = await authService.verifyOtp(email, otp);

    ApiResponse.success(res, result, 'OTP verified');
  } catch (error) {
    next(error);
  }
};

// Reset password
export const resetPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, resetToken, newPassword } = req.body;
    const result = await authService.resetPassword(email, resetToken, newPassword);

    ApiResponse.success(res, result);
  } catch (error) {
    next(error);
  }
};
