import { body } from 'express-validator';

export const updateVersionValidation = [
  body('description')
    .optional()
    .isString()
    .withMessage('Description must be a string'),
  body('videoUrl')
    .optional()
    .isURL()
    .withMessage('Video URL must be a valid URL'),
];

export const updateStatusValidation = [
  body('status')
    .isIn(['PROCESSING', 'NEEDS_REVIEW', 'CHANGES_REQUESTED', 'APPROVED'])
    .withMessage('Invalid status'),
];

export const addFeedbackValidation = [
  body('rawText')
    .trim()
    .isLength({ min: 1 })
    .withMessage('Feedback text is required'),
  body('structuredText')
    .optional()
    .isString()
    .withMessage('Structured text must be a string'),
  body('type')
    .optional()
    .isIn(['TEXT', 'AUDIO'])
    .withMessage('Type must be TEXT or AUDIO'),
  body('tasks')
    .optional()
    .isArray()
    .withMessage('Tasks must be an array'),
  body('tasks.*.description')
    .optional()
    .isString()
    .withMessage('Task description must be a string'),
];
