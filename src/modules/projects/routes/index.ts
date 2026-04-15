import { Router } from 'express';
import { authenticate } from '../../../middlewares/auth';
import { validate } from '../../../middlewares/validate';
import * as projectsController from '../controllers';
import { createProjectValidation, updateProjectValidation, updateStatusValidation } from '../validators';

const router = Router();

router.use(authenticate);

// CRUD operations (REST)
router.post('/', validate(createProjectValidation), projectsController.createProject);
router.put('/:id', validate(updateProjectValidation), projectsController.updateProject);
router.patch('/:id/status', validate(updateStatusValidation), projectsController.updateProjectStatus);
router.delete('/:id', projectsController.deleteProject);

// Archive and restore operations
router.post('/:id/archive', projectsController.archiveProject);
router.post('/:id/restore', projectsController.restoreProject);

// Nested routes
router.get('/:id/deliverables', projectsController.getProjectDeliverables);
router.post('/:id/deliverables', projectsController.addDeliverable);
router.get('/:id/media', projectsController.getProjectMedia);
router.post('/:id/media', projectsController.addProjectMedia);
router.get('/:id/members', projectsController.getProjectMembers);

// Brief completion (for CLIENT project onboarding)
router.post('/:id/complete-brief', projectsController.completeBrief);

// Transfer ownership (initiate request)
router.post('/:id/transfer-ownership', projectsController.transferOwnership);

// Verify transfer ownership request (for UI display)
router.get('/transfer/verify/:token', projectsController.verifyTransferOwnership);

// Accept transfer ownership request
router.post('/transfer/accept/:token', projectsController.acceptTransferOwnership);

// Reject transfer ownership request
router.post('/transfer/reject/:token', projectsController.rejectTransferOwnership);

// Cancel transfer ownership request (by initiator)
router.delete('/transfer/:token', projectsController.cancelTransferOwnership);

export default router;
