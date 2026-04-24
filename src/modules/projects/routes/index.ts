import { Router } from 'express';
import { authenticate } from '../../../middlewares/auth';
import { validate } from '../../../middlewares/validate';
import { requireProjectAccess, requireProjectOwner } from '../../../middlewares/permissions';
import * as projectsController from '../controllers';
import { createProjectValidation, updateProjectValidation, updateStatusValidation } from '../validators';

const router = Router();

router.use(authenticate);

// CRUD operations (REST). Every :id route below enforces project-level
// access control — without this, any authenticated user could hit
// /api/v1/projects/<any-uuid>/... and read/write someone else's project.

// Create is open to any authenticated user.
router.post('/', validate(createProjectValidation), projectsController.createProject);

// Update / destructive operations require OWNER (or admin via the bypass
// baked into requireProjectOwner).
router.put('/:id', requireProjectOwner(), validate(updateProjectValidation), projectsController.updateProject);
router.patch('/:id/status', requireProjectOwner(), validate(updateStatusValidation), projectsController.updateProjectStatus);
router.delete('/:id', requireProjectOwner(), projectsController.deleteProject);

// Archive and restore: owner-only.
router.post('/:id/archive', requireProjectOwner(), projectsController.archiveProject);
router.post('/:id/restore', requireProjectOwner(), projectsController.restoreProject);

// Reads: any member (view permission). Writes on nested resources: edit
// permission.
router.get('/:id/deliverables', requireProjectAccess('view'), projectsController.getProjectDeliverables);
router.post('/:id/deliverables', requireProjectAccess('edit'), projectsController.addDeliverable);
router.get('/:id/media', requireProjectAccess('view'), projectsController.getProjectMedia);
router.post('/:id/media', requireProjectAccess('edit'), projectsController.addProjectMedia);
router.get('/:id/members', requireProjectAccess('view'), projectsController.getProjectMembers);

// Brief completion (for CLIENT project onboarding) — owner only.
router.post('/:id/complete-brief', requireProjectOwner(), projectsController.completeBrief);

// Transfer ownership (initiate request) — owner only.
router.post('/:id/transfer-ownership', requireProjectOwner(), projectsController.transferOwnership);

// Transfer verification / accept / reject endpoints are keyed by token, not
// projectId — the token itself authorises the action, so no project middleware
// is applied. The controllers validate the token + caller identity.
router.get('/transfer/verify/:token', projectsController.verifyTransferOwnership);
router.post('/transfer/accept/:token', projectsController.acceptTransferOwnership);
router.post('/transfer/reject/:token', projectsController.rejectTransferOwnership);
router.delete('/transfer/:token', projectsController.cancelTransferOwnership);

export default router;
