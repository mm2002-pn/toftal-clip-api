import { Router } from 'express';
import { authenticate } from '../../../middlewares/auth';
import { validate } from '../../../middlewares/validate';
import * as workflowController from '../controllers';
import {
  createPhaseValidation,
  updatePhaseValidation,
  createTaskValidation,
  updateTaskValidation,
} from '../validators';

const router = Router();

router.use(authenticate);

// Phases
router.post('/phases', validate(createPhaseValidation), workflowController.createPhase);
router.put('/phases/:id', validate(updatePhaseValidation), workflowController.updatePhase);
router.delete('/phases/:id', workflowController.deletePhase);

// Tasks
router.post('/phases/:phaseId/tasks', validate(createTaskValidation), workflowController.createTask);
router.put('/tasks/:id', validate(updateTaskValidation), workflowController.updateTask);
router.delete('/tasks/:id', workflowController.deleteTask);
router.patch('/tasks/:id/toggle', workflowController.toggleTask);

export default router;
