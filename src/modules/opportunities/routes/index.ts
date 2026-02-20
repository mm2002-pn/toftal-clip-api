import { Router } from 'express';
import { authenticate } from '../../../middlewares/auth';
import { validate } from '../../../middlewares/validate';
import * as opportunitiesController from '../controllers';
import {
  createOpportunityValidation,
  updateOpportunityValidation,
  applyValidation,
  updateApplicationValidation,
} from '../validators';

const router = Router();

router.use(authenticate);

// Opportunities CRUD
router.post('/', validate(createOpportunityValidation), opportunitiesController.createOpportunity);
router.put('/:id', validate(updateOpportunityValidation), opportunitiesController.updateOpportunity);
router.delete('/:id', opportunitiesController.deleteOpportunity);

// Applications - Talent actions
router.post('/:id/apply', validate(applyValidation), opportunitiesController.applyToOpportunity);
router.get('/my-applications', opportunitiesController.getMyApplications);
router.delete('/applications/:applicationId', opportunitiesController.withdrawApplication);

// Applications - Client actions
router.get('/:id/applications', opportunitiesController.getOpportunityApplications);
router.patch('/:id/applications/:applicationId', validate(updateApplicationValidation), opportunitiesController.updateApplicationStatus);

export default router;
