import { Router } from 'express';
import { authenticate } from '../../../middlewares/auth';
import { validate } from '../../../middlewares/validate';
import * as feedbackController from '../controllers';
import { updateFeedbackValidation, addRevisionTaskValidation } from '../validators';

const router = Router();

router.use(authenticate);

// Feedback CRUD
router.put('/:id', validate(updateFeedbackValidation), feedbackController.updateFeedback);
router.delete('/:id', feedbackController.deleteFeedback);

// Revision Tasks
router.post('/:id/tasks', validate(addRevisionTaskValidation), feedbackController.addRevisionTask);
router.patch('/:id/tasks/:taskId/toggle', feedbackController.toggleRevisionTask);
router.delete('/:id/tasks/:taskId', feedbackController.deleteRevisionTask);

// Simpler task routes (taskId only)
router.patch('/tasks/:taskId/toggle', feedbackController.toggleRevisionTask);
router.delete('/tasks/:taskId', feedbackController.deleteRevisionTask);

export default router;
