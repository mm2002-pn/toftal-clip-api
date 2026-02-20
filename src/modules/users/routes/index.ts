import { Router } from 'express';
import { authenticate, authorize } from '../../../middlewares/auth';
import * as usersController from '../controllers';

const router = Router();

// All routes require authentication
router.use(authenticate);

router.get('/:id', usersController.getUser);
router.put('/:id', usersController.updateUser);
router.delete('/:id', authorize('ADMIN'), usersController.deleteUser);

export default router;
