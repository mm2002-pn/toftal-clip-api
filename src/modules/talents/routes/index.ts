import { Router } from 'express';
import { authenticate } from '../../../middlewares/auth';
import { validate } from '../../../middlewares/validate';
import * as talentsController from '../controllers';
import * as profileController from '../controllers/profile';
import * as portfolioController from '../controllers/portfolio';
import {
  createProfileValidation,
  updateProfileValidation,
  addPortfolioItemValidation,
  addPackageValidation,
  addReviewValidation,
} from '../validators';

const router = Router();

// ==================== TALENT PROFILE ====================

// Get talent profile by ID (public)
router.get('/profile/:id', profileController.getTalentProfile);

// Get talent profile by userId (public)
router.get('/profile/user/:userId', profileController.getTalentProfileByUserId);

// Create talent profile
router.post('/', authenticate, validate(createProfileValidation), talentsController.createProfile);

// Update talent profile (basic info)
router.put('/:id', authenticate, validate(updateProfileValidation), talentsController.updateProfile);

// Update talent profile (professional info: tagline, social links, stats, expertise, skills)
router.put('/:id/professional', authenticate, profileController.updateTalentProfile);

// ==================== PORTFOLIO ====================

// Add portfolio item
router.post('/:talentId/portfolio', authenticate, validate(addPortfolioItemValidation), portfolioController.addPortfolioItem);

// Update portfolio item
router.put('/portfolio/:id', authenticate, portfolioController.updatePortfolioItem);

// Delete portfolio item
router.delete('/portfolio/:id', authenticate, portfolioController.deletePortfolioItem);

// Reorder portfolio items
router.put('/:talentId/portfolio/reorder', authenticate, portfolioController.reorderPortfolioItems);

// Legacy routes (keep for backward compatibility)
router.delete('/:id/portfolio/:itemId', authenticate, talentsController.deletePortfolioItem);

// ==================== PACKAGES ====================

router.post('/:id/packages', authenticate, validate(addPackageValidation), talentsController.addPackage);
router.put('/:id/packages/:packageId', authenticate, validate(addPackageValidation), talentsController.updatePackage);
router.delete('/:id/packages/:packageId', authenticate, talentsController.deletePackage);

// ==================== REVIEWS ====================

router.post('/:id/reviews', authenticate, validate(addReviewValidation), talentsController.addReview);

export default router;
