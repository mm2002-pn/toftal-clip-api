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

// WhatsApp-style read receipts (group)
router.post('/bulk-read', feedbackController.bulkMarkFeedbacksAsRead);

// Emoji reactions (WhatsApp-style quick reactions)
router.post('/:id/reactions', feedbackController.toggleFeedbackReaction);

// Vimeo-style video review - Toggle resolved status
router.patch('/:id/resolve', feedbackController.toggleFeedbackResolved);

// Revision Tasks
router.post('/:id/tasks', validate(addRevisionTaskValidation), feedbackController.addRevisionTask);
router.patch('/:id/tasks/:taskId/toggle', feedbackController.toggleRevisionTask);
router.delete('/:id/tasks/:taskId', feedbackController.deleteRevisionTask);

// Simpler task routes (taskId only)
router.patch('/tasks/:taskId/toggle', feedbackController.toggleRevisionTask);
router.delete('/tasks/:taskId', feedbackController.deleteRevisionTask);

export default router;
