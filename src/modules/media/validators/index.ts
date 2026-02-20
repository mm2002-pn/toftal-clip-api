import { body } from 'express-validator';

export const signatureValidation = [
  body('folder')
    .optional()
    .isString()
    .withMessage('Folder must be a string'),
  body('resourceType')
    .optional()
    .isIn(['image', 'video', 'raw'])
    .withMessage('Resource type must be image, video, or raw'),
];

export const registerMediaValidation = [
  body('projectId')
    .isUUID()
    .withMessage('Project ID must be a valid UUID'),
  body('deliverableId')
    .optional()
    .isUUID()
    .withMessage('Deliverable ID must be a valid UUID'),
  body('name')
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Name is required and must be max 255 characters'),
  body('url')
    .isURL()
    .withMessage('URL must be a valid URL'),
  body('publicId')
    .optional()
    .isString()
    .withMessage('Public ID must be a string'),
  body('type')
    .optional()
    .isIn(['VIDEO', 'AUDIO', 'DOCUMENT', 'FOLDER', 'IMAGE'])
    .withMessage('Invalid media type'),
  body('category')
    .optional()
    .isString()
    .withMessage('Category must be a string'),
];
