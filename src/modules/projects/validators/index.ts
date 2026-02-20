import { body } from 'express-validator';

export const createProjectValidation = [
  body('title')
    .trim()
    .isLength({ min: 3, max: 200 })
    .withMessage('Title must be between 3 and 200 characters'),
  body('deadline')
    .optional()
    .isISO8601()
    .withMessage('Deadline must be a valid date'),
  body('brief')
    .optional()
    .isObject()
    .withMessage('Brief must be an object'),
  body('brief.contentType')
    .optional()
    .isString(),
  body('brief.objective')
    .optional()
    .isString(),
  body('brief.targetAudience')
    .optional()
    .isString(),
  body('brief.tone')
    .optional()
    .isString(),
  body('brief.budget')
    .optional()
    .isString(),
];

export const updateProjectValidation = [
  body('title')
    .optional()
    .trim()
    .isLength({ min: 3, max: 200 })
    .withMessage('Title must be between 3 and 200 characters'),
  body('deadline')
    .optional()
    .isISO8601()
    .withMessage('Deadline must be a valid date'),
  body('talentId')
    .optional()
    .isUUID()
    .withMessage('Talent ID must be a valid UUID'),
  body('brief')
    .optional()
    .isObject()
    .withMessage('Brief must be an object'),
];

export const updateStatusValidation = [
  body('status')
    .isIn(['DRAFT', 'MATCHING', 'IN_PROGRESS', 'REVIEW', 'COMPLETED'])
    .withMessage('Invalid status'),
];
