import { body } from 'express-validator';

export const createPhaseValidation = [
  body('deliverableId')
    .isUUID()
    .withMessage('Deliverable ID must be a valid UUID'),
  body('title')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Title must be between 2 and 100 characters'),
];

export const updatePhaseValidation = [
  body('title')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Title must be between 2 and 100 characters'),
  body('status')
    .optional()
    .isIn(['pending', 'active', 'completed'])
    .withMessage('Status must be pending, active, or completed'),
];

export const createTaskValidation = [
  body('title')
    .trim()
    .isLength({ min: 2, max: 200 })
    .withMessage('Title must be between 2 and 200 characters'),
  body('assignedTo')
    .optional()
    .isIn(['CLIENT', 'TALENT'])
    .withMessage('AssignedTo must be CLIENT or TALENT'),
];

export const updateTaskValidation = [
  body('title')
    .optional()
    .trim()
    .isLength({ min: 2, max: 200 })
    .withMessage('Title must be between 2 and 200 characters'),
  body('assignedTo')
    .optional()
    .isIn(['CLIENT', 'TALENT'])
    .withMessage('AssignedTo must be CLIENT or TALENT'),
];
