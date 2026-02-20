import { Router } from 'express';
import { authenticate } from '../../../middlewares/auth';
import * as analyticsController from '../controllers';

const router = Router();

router.use(authenticate);

router.get('/dashboard', analyticsController.getDashboardStats);
router.get('/projects', analyticsController.getProjectStats);
router.get('/talents/:id', analyticsController.getTalentStats);

export default router;
