import { Router } from 'express';
import { authenticate } from '../../../middlewares/auth';
import * as deviceTokensController from '../controllers';

const router = Router();

router.use(authenticate);

router.post('/', deviceTokensController.registerDeviceToken);
router.delete('/:token', deviceTokensController.unregisterDeviceToken);

export default router;
