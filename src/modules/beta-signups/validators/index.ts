import { body } from 'express-validator';

export const createBetaSignupValidation = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),

  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail(),

  body('contact')
    .trim()
    .notEmpty()
    .withMessage('Contact is required'),

  body('role')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Role must not exceed 100 characters'),

  body('videoCount')
    .optional()
    .trim(),

  body('collaboration')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Collaboration description must not exceed 500 characters'),

  body('biggestProblem')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Problem description must not exceed 2000 characters'),

  body('interests')
    .optional()
    .isArray()
    .withMessage('Interests must be an array'),

  body('feedbackReady')
    .optional()
    .trim()
    .isIn(['Oui', 'Oui et participer à un appel feedback', 'Non'])
    .withMessage('Invalid feedback readiness value'),

  body('link')
    .optional()
    .trim()
    .isURL()
    .withMessage('Portfolio link must be a valid URL'),

  body('marketplaceInterest')
    .optional()
    .trim()
    .isIn(['Oui', 'Non', 'Peut-être'])
    .withMessage('Invalid marketplace interest value'),

  body('source')
    .optional()
    .trim()
    .isIn(['Twitter / X', 'LinkedIn', 'Instagram', 'Recommandation', 'Autre'])
    .withMessage('Invalid source value'),
];
