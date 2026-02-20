import { body } from 'express-validator';

export const createProfileValidation = [
  body('bio')
    .optional()
    .isString()
    .isLength({ max: 1000 })
    .withMessage('Bio must be max 1000 characters'),
  body('location')
    .optional()
    .isString()
    .withMessage('Location must be a string'),
  body('languages')
    .optional()
    .isArray()
    .withMessage('Languages must be an array'),
  body('skills')
    .optional()
    .isArray()
    .withMessage('Skills must be an array'),
  body('videoType')
    .optional()
    .isString()
    .withMessage('Video type must be a string'),
  body('startingPrice')
    .optional()
    .isString()
    .withMessage('Starting price must be a string'),
];

export const updateProfileValidation = [
  body('bio')
    .optional()
    .isString()
    .isLength({ max: 1000 })
    .withMessage('Bio must be max 1000 characters'),
  body('location')
    .optional()
    .isString()
    .withMessage('Location must be a string'),
  body('languages')
    .optional()
    .isArray()
    .withMessage('Languages must be an array'),
  body('skills')
    .optional()
    .isArray()
    .withMessage('Skills must be an array'),
  body('videoType')
    .optional()
    .isString()
    .withMessage('Video type must be a string'),
  body('responseTime')
    .optional()
    .isString()
    .withMessage('Response time must be a string'),
  body('startingPrice')
    .optional()
    .isString()
    .withMessage('Starting price must be a string'),
  body('coverImage')
    .optional()
    .isURL()
    .withMessage('Cover image must be a valid URL'),
];

export const addPortfolioItemValidation = [
  body('thumbnail')
    .isURL()
    .withMessage('Thumbnail must be a valid URL'),
  body('title')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Title must be between 2 and 100 characters'),
  body('views')
    .optional()
    .isString()
    .withMessage('Views must be a string'),
];

export const addPackageValidation = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),
  body('price')
    .trim()
    .notEmpty()
    .withMessage('Price is required'),
  body('description')
    .optional()
    .isString()
    .withMessage('Description must be a string'),
  body('features')
    .optional()
    .isArray()
    .withMessage('Features must be an array'),
  body('isPopular')
    .optional()
    .isBoolean()
    .withMessage('isPopular must be a boolean'),
];

export const addReviewValidation = [
  body('rating')
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be between 1 and 5'),
  body('text')
    .optional()
    .isString()
    .isLength({ max: 1000 })
    .withMessage('Review text must be max 1000 characters'),
];
