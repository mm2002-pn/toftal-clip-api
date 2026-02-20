import { Router } from 'express';
import { authenticate } from '../../../middlewares/auth';
import { validate } from '../../../middlewares/validate';
import * as versionsController from '../controllers';
import {
  updateVersionValidation,
  updateStatusValidation,
  addFeedbackValidation,
} from '../validators';

const router = Router();

router.use(authenticate);

router.put('/:id', validate(updateVersionValidation), versionsController.updateVersion);
router.delete('/:id', versionsController.deleteVersion);
router.patch('/:id/status', validate(updateStatusValidation), versionsController.updateStatus);
router.post('/:id/feedback', validate(addFeedbackValidation), versionsController.addFeedback);

export default router;
