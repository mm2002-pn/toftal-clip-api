import { body } from 'express-validator';

export const createOpportunityValidation = [
  body('title')
    .trim()
    .isLength({ min: 5, max: 200 })
    .withMessage('Title must be between 5 and 200 characters'),
  body('type')
    .isIn(['Shorts', 'YouTube_Long', 'Podcast', 'Miniatures'])
    .withMessage('Invalid opportunity type'),
  body('volume')
    .optional()
    .isString()
    .withMessage('Volume must be a string'),
  body('duration')
    .optional()
    .isString()
    .withMessage('Duration must be a string'),
  body('style')
    .optional()
    .isString()
    .withMessage('Style must be a string'),
  body('deadline')
    .optional()
    .isString()
    .withMessage('Deadline must be a string'),
  body('level')
    .optional()
    .isIn(['Confirmé', 'Confirme', 'Expert'])
    .withMessage('Level must be Confirmé or Expert'),
  body('description')
    .optional()
    .isString()
    .isLength({ max: 2000 })
    .withMessage('Description must be max 2000 characters'),
  body('isRecurring')
    .optional()
    .isBoolean()
    .withMessage('isRecurring must be a boolean'),
];

export const updateOpportunityValidation = [
  body('title')
    .optional()
    .trim()
    .isLength({ min: 5, max: 200 })
    .withMessage('Title must be between 5 and 200 characters'),
  body('type')
    .optional()
    .isIn(['Shorts', 'YouTube_Long', 'Podcast', 'Miniatures'])
    .withMessage('Invalid opportunity type'),
  body('level')
    .optional()
    .isIn(['Confirmé', 'Confirme', 'Expert'])
    .withMessage('Level must be Confirmé or Expert'),
  body('description')
    .optional()
    .isString()
    .isLength({ max: 2000 })
    .withMessage('Description must be max 2000 characters'),
];

export const applyValidation = [
  body('message')
    .optional()
    .isString()
    .isLength({ max: 1000 })
    .withMessage('Message must be max 1000 characters'),
];

export const updateApplicationValidation = [
  body('status')
    .isIn(['PENDING', 'ACCEPTED', 'REJECTED'])
    .withMessage('Status must be PENDING, ACCEPTED, or REJECTED'),
];
