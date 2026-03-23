import { body } from 'express-validator';

export const registerValidation = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one uppercase, one lowercase and one number'),
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),
  // role removed - all new users are USER by default
];

export const loginValidation = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail(),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
];

export const changePasswordValidation = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one uppercase, one lowercase and one number'),
];

export const googleAuthValidation = [
  body('idToken')
    .notEmpty()
    .withMessage('Firebase ID token is required'),
  // role removed - all new users are USER by default
];

export const verifyEmailValidation = [
  body('token')
    .notEmpty()
    .withMessage('Verification token is required'),
];

export const resendVerificationValidation = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail(),
];

// Enable talent mode validation
export const enableTalentModeValidation = [
  body('questionnaire')
    .notEmpty()
    .withMessage('Questionnaire is required'),
  body('questionnaire.isCreator')
    .isBoolean()
    .withMessage('isCreator must be boolean'),
  body('questionnaire.seekingWork')
    .isBoolean()
    .withMessage('seekingWork must be boolean'),
  body('questionnaire.hasPortfolio')
    .isBoolean()
    .withMessage('hasPortfolio must be boolean'),
  body('questionnaire.isFreelance')
    .isBoolean()
    .withMessage('isFreelance must be boolean'),
];
