import { Router } from 'express';
import { authLimiter } from '../../../middlewares/rateLimiter';
import { authenticate } from '../../../middlewares/auth';
import { validate } from '../../../middlewares/validate';
import * as authController from '../controllers';
import {
  registerValidation,
  loginValidation,
  changePasswordValidation,
  googleAuthValidation,
  verifyEmailValidation,
  resendVerificationValidation,
  enableTalentModeValidation
} from '../validators';

const router = Router();

// Public routes (with rate limiting)
router.post('/register', authLimiter, validate(registerValidation), authController.register);
router.post('/login', authLimiter, validate(loginValidation), authController.login);
router.post('/google', authLimiter, validate(googleAuthValidation), authController.googleAuth);
router.post('/refresh', authController.refreshToken);
router.post('/verify-email', validate(verifyEmailValidation), authController.verifyEmail);
router.post('/resend-verification', authLimiter, validate(resendVerificationValidation), authController.resendVerification);
router.post('/forgot-password', authLimiter, authController.forgotPassword);
router.post('/verify-otp', authLimiter, authController.verifyOtp);
router.post('/reset-password', authLimiter, authController.resetPassword);

// Protected routes
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.getMe);
router.post('/change-password', authenticate, validate(changePasswordValidation), authController.changePassword);

// Talent mode management (protected)
router.patch('/enable-talent-mode', authenticate, validate(enableTalentModeValidation), authController.enableTalentMode);
router.patch('/disable-talent-mode', authenticate, authController.disableTalentMode);

export default router;
