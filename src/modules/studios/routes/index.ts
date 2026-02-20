import { Router } from 'express';
import { authenticate, authorize } from '../../../middlewares/auth';
import { validate } from '../../../middlewares/validate';
import * as studiosController from '../controllers';
import { createStudioValidation, updateStudioValidation } from '../validators';

const router = Router();

// Studio management routes
router.post('/', authenticate, authorize('ADMIN', 'CLIENT'), validate(createStudioValidation), studiosController.createStudio);
router.put('/:id', authenticate, authorize('ADMIN', 'CLIENT'), validate(updateStudioValidation), studiosController.updateStudio);
router.delete('/:id', authenticate, authorize('ADMIN'), studiosController.deleteStudio); // Only admin can delete

export default router;
