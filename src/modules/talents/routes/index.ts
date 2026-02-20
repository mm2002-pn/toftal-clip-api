import { Router } from 'express';
import { authenticate } from '../../../middlewares/auth';
import { validate } from '../../../middlewares/validate';
import * as talentsController from '../controllers';
import {
  createProfileValidation,
  updateProfileValidation,
  addPortfolioItemValidation,
  addPackageValidation,
  addReviewValidation,
} from '../validators';

const router = Router();

// Profile (REST for CUD, GraphQL for Read)
router.post('/', authenticate, validate(createProfileValidation), talentsController.createProfile);
router.put('/:id', authenticate, validate(updateProfileValidation), talentsController.updateProfile);

// Portfolio
router.post('/:id/portfolio', authenticate, validate(addPortfolioItemValidation), talentsController.addPortfolioItem);
router.delete('/:id/portfolio/:itemId', authenticate, talentsController.deletePortfolioItem);

// Packages
router.post('/:id/packages', authenticate, validate(addPackageValidation), talentsController.addPackage);
router.put('/:id/packages/:packageId', authenticate, validate(addPackageValidation), talentsController.updatePackage);
router.delete('/:id/packages/:packageId', authenticate, talentsController.deletePackage);

// Reviews
router.post('/:id/reviews', authenticate, validate(addReviewValidation), talentsController.addReview);

export default router;
