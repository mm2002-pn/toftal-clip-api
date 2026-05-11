import { Router } from 'express';
import { authenticate } from '../../../middlewares/auth';
import { validate } from '../../../middlewares/validate';
import { requireDeliverableAccess } from '../../../middlewares/permissions';
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

// Every :id route below enforces deliverable → parent-project access so a
// simple `PATCH /api/v1/deliverables/<any-uuid>` from a non-member is rejected
// with 403 instead of succeeding silently. Assigned talent keeps edit rights
// on their own deliverables (handled inside requireDeliverableAccess).

// CRUD operations — edit permission required.
router.put('/:id', requireDeliverableAccess('edit'), validate(updateDeliverableValidation), deliverablesController.updateDeliverable);
router.patch('/:id', requireDeliverableAccess('edit'), validate(updateDeliverableValidation), deliverablesController.updateDeliverable); // Same controller, supports partial updates
router.delete('/:id', requireDeliverableAccess('edit'), deliverablesController.deleteDeliverable);
router.patch('/:id/assign', requireDeliverableAccess('edit'), validate(assignTalentValidation), deliverablesController.assignTalent);
router.patch('/:id/status', requireDeliverableAccess('edit'), validate(updateStatusValidation), deliverablesController.updateStatus);
router.patch('/:id/validate', requireDeliverableAccess('approve'), deliverablesController.validateDeliverable);

// Assignment acceptance — must be the assigned talent (handled inside the
// middleware via the assignedTalentId bypass) or project member with edit.
router.patch('/:id/accept', requireDeliverableAccess('edit'), deliverablesController.acceptAssignment);
router.patch('/:id/reject', requireDeliverableAccess('edit'), deliverablesController.rejectAssignment);

// Versions (Create only - Read via GraphQL) — edit permission required.
router.post('/:id/versions', requireDeliverableAccess('edit'), validate(addVersionValidation), deliverablesController.addVersion);
router.post('/:id/versions/:versionId/extract-metadata', requireDeliverableAccess('edit'), deliverablesController.extractVersionMetadata);
router.post('/:id/versions/:versionId/downscale', requireDeliverableAccess('edit'), deliverablesController.downscaleVersion);
router.get('/:id/versions/:versionId/downscale/:quality/status', requireDeliverableAccess('view'), deliverablesController.downscaleVersionStatus);

// Media (Create only - Read via GraphQL) — edit permission required.
router.post('/:id/media', requireDeliverableAccess('edit'), validate(addMediaValidation), deliverablesController.addMedia);

export default router;
