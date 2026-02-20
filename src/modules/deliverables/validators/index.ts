import { body } from 'express-validator';

export const updateDeliverableValidation = [
  body('title')
    .optional()
    .trim()
    .isLength({ min: 2, max: 200 })
    .withMessage('Title must be between 2 and 200 characters'),
  body('type')
    .optional()
    .isString()
    .withMessage('Type must be a string'),
  body('deadline')
    .optional()
    .isISO8601()
    .withMessage('Deadline must be a valid date'),
];

export const assignTalentValidation = [
  body('talentId')
    .isUUID()
    .withMessage('Talent ID must be a valid UUID'),
];

export const updateStatusValidation = [
  body('status')
    .isIn(['NOT_STARTED', 'IN_PROGRESS', 'REVIEW', 'COMPLETED'])
    .withMessage('Invalid status'),
  body('progress')
    .optional()
    .isInt({ min: 0, max: 100 })
    .withMessage('Progress must be between 0 and 100'),
];

export const addVersionValidation = [
  body('videoUrl')
    .isURL()
    .withMessage('Video URL must be a valid URL'),
  body('description')
    .optional()
    .isString()
    .withMessage('Description must be a string'),
];

export const addMediaValidation = [
  body('name')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Name is required'),
  body('url')
    .isURL()
    .withMessage('URL must be a valid URL'),
  body('type')
    .isIn(['VIDEO', 'AUDIO', 'DOCUMENT', 'FOLDER', 'IMAGE'])
    .withMessage('Invalid media type'),
  body('category')
    .optional()
    .isString()
    .withMessage('Category must be a string'),
];
