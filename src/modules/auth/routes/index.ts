import { Router } from 'express';
import { authLimiter } from '../../../middlewares/rateLimiter';
import { authenticate } from '../../../middlewares/auth';
import { validate } from '../../../middlewares/validate';
import * as authController from '../controllers';
import { registerValidation, loginValidation, changePasswordValidation } from '../validators';

const router = Router();

// Public routes (with rate limiting)
router.post('/register', authLimiter, validate(registerValidation), authController.register);
router.post('/login', authLimiter, validate(loginValidation), authController.login);
router.post('/refresh', authController.refreshToken);

// Protected routes
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.getMe);
router.post('/change-password', authenticate, validate(changePasswordValidation), authController.changePassword);

export default router;
