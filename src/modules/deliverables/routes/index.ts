import { Router } from 'express';
import { authenticate } from '../../../middlewares/auth';
import { validate } from '../../../middlewares/validate';
import * as deliverablesController from '../controllers';
import {
  updateDeliverableValidation,
  assignTalentValidation,
  updateStatusValidation,
  addVersionValidation,
  addMediaValidation,
} from '../validators';

const router = Router();

router.use(authenticate);

// CRUD operations
router.put('/:id', validate(updateDeliverableValidation), deliverablesController.updateDeliverable);
router.patch('/:id', validate(updateDeliverableValidation), deliverablesController.updateDeliverable); // Same controller, supports partial updates
router.delete('/:id', deliverablesController.deleteDeliverable);
router.patch('/:id/assign', validate(assignTalentValidation), deliverablesController.assignTalent);
router.patch('/:id/status', validate(updateStatusValidation), deliverablesController.updateStatus);
router.patch('/:id/validate', deliverablesController.validateDeliverable);

// Assignment acceptance
router.patch('/:id/accept', deliverablesController.acceptAssignment);
router.patch('/:id/reject', deliverablesController.rejectAssignment);

// Versions (Create only - Read via GraphQL)
router.post('/:id/versions', validate(addVersionValidation), deliverablesController.addVersion);
router.post('/:id/versions/:versionId/extract-metadata', deliverablesController.extractVersionMetadata);
router.post('/:id/versions/:versionId/downscale', deliverablesController.downscaleVersion);

// Media (Create only - Read via GraphQL)
router.post('/:id/media', validate(addMediaValidation), deliverablesController.addMedia);

export default router;
