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
    .optional({ nullable: true })
    .custom((value) => {
      // Allow null to remove talent assignment
      if (value === null) return true;
      // Otherwise, must be a valid UUID
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(value)) {
        throw new Error('Talent ID must be a valid UUID');
      }
      return true;
    }),
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
