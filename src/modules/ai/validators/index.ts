import { body } from 'express-validator';

export const optimizeBriefValidation = [
  body('brief')
    .isObject()
    .withMessage('Brief must be an object'),
  body('brief.contentType')
    .optional()
    .isString()
    .withMessage('Content type must be a string'),
  body('brief.objective')
    .optional()
    .isString()
    .withMessage('Objective must be a string'),
  body('brief.targetAudience')
    .optional()
    .isString()
    .withMessage('Target audience must be a string'),
  body('brief.tone')
    .optional()
    .isString()
    .withMessage('Tone must be a string'),
];

export const matchTalentsValidation = [
  body('brief')
    .isObject()
    .withMessage('Brief must be an object'),
];

export const analyzeVideoValidation = [
  body('description')
    .trim()
    .isLength({ min: 10 })
    .withMessage('Description must be at least 10 characters'),
];

export const transcribeValidation = [
  body('audioBase64')
    .isString()
    .isLength({ min: 100 })
    .withMessage('Audio data is required'),
  body('mimeType')
    .optional()
    .isString()
    .withMessage('Mime type must be a string'),
];

export const generateTasksValidation = [
  body('feedbackText')
    .trim()
    .isLength({ min: 5 })
    .withMessage('Feedback text must be at least 5 characters'),
];

export const rephraseValidation = [
  body('text')
    .trim()
    .isLength({ min: 5 })
    .withMessage('Text must be at least 5 characters'),
];
