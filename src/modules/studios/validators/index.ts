import { body } from 'express-validator';

export const createStudioValidation = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),
  body('location')
    .optional()
    .isString()
    .isLength({ max: 200 })
    .withMessage('Location must be max 200 characters'),
  body('pricePerHour')
    .optional()
    .isString()
    .withMessage('Price per hour must be a string'),
  body('thumbnail')
    .optional()
    .isURL()
    .withMessage('Thumbnail must be a valid URL'),
  body('gallery')
    .optional()
    .isArray()
    .withMessage('Gallery must be an array of URLs'),
  body('gallery.*')
    .optional()
    .isURL()
    .withMessage('Each gallery item must be a valid URL'),
  body('tags')
    .optional()
    .isArray()
    .withMessage('Tags must be an array'),
  body('tags.*')
    .optional()
    .isString()
    .withMessage('Each tag must be a string'),
  body('description')
    .optional()
    .isString()
    .isLength({ max: 2000 })
    .withMessage('Description must be max 2000 characters'),
  body('features')
    .optional()
    .isArray()
    .withMessage('Features must be an array'),
  body('features.*')
    .optional()
    .isString()
    .withMessage('Each feature must be a string'),
  body('whatsappNumber')
    .optional()
    .isString()
    .withMessage('WhatsApp number must be a string'),
];

export const updateStudioValidation = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),
  body('location')
    .optional()
    .isString()
    .isLength({ max: 200 })
    .withMessage('Location must be max 200 characters'),
  body('pricePerHour')
    .optional()
    .isString()
    .withMessage('Price per hour must be a string'),
  body('thumbnail')
    .optional()
    .isURL()
    .withMessage('Thumbnail must be a valid URL'),
  body('gallery')
    .optional()
    .isArray()
    .withMessage('Gallery must be an array of URLs'),
  body('tags')
    .optional()
    .isArray()
    .withMessage('Tags must be an array'),
  body('description')
    .optional()
    .isString()
    .isLength({ max: 2000 })
    .withMessage('Description must be max 2000 characters'),
  body('features')
    .optional()
    .isArray()
    .withMessage('Features must be an array'),
  body('rating')
    .optional()
    .isFloat({ min: 0, max: 5 })
    .withMessage('Rating must be between 0 and 5'),
];
