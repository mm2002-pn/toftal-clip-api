import { body } from 'express-validator';

export const updateFeedbackValidation = [
  body('rawText')
    .optional()
    .trim()
    .isLength({ min: 1 })
    .withMessage('Feedback text cannot be empty'),
  body('structuredText')
    .optional()
    .isString()
    .withMessage('Structured text must be a string'),
];

export const addRevisionTaskValidation = [
  body('description')
    .trim()
    .isLength({ min: 2, max: 500 })
    .withMessage('Description must be between 2 and 500 characters'),
];
