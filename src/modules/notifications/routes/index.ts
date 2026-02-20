import { Router } from 'express';
import { authenticate } from '../../../middlewares/auth';
import * as notificationsController from '../controllers';

const router = Router();

router.use(authenticate);

router.get('/', notificationsController.getNotifications);
router.patch('/:id/read', notificationsController.markAsRead);
router.patch('/read-all', notificationsController.markAllAsRead);
router.delete('/:id', notificationsController.deleteNotification);

export default router;
