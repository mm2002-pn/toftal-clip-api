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

// Nested routes
router.get('/:id/deliverables', projectsController.getProjectDeliverables);
router.post('/:id/deliverables', projectsController.addDeliverable);
router.get('/:id/media', projectsController.getProjectMedia);
router.post('/:id/media', projectsController.addProjectMedia);

export default router;
