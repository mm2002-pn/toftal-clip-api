import { Router } from 'express';
import { authenticate } from '../../../middlewares/auth';
import { aiLimiter } from '../../../middlewares/rateLimiter';
import { validate } from '../../../middlewares/validate';
import * as aiController from '../controllers';
import {
  optimizeBriefValidation,
  matchTalentsValidation,
  analyzeVideoValidation,
  transcribeValidation,
  generateTasksValidation,
  rephraseValidation,
} from '../validators';

const router = Router();

// Debug route (no auth for testing)
router.get('/debug-config', aiController.debugConfig);

router.use(authenticate);
router.use(aiLimiter);

router.post('/optimize-brief', validate(optimizeBriefValidation), aiController.optimizeBrief);
router.post('/match-talents', validate(matchTalentsValidation), aiController.matchTalents);
router.post('/analyze-video', validate(analyzeVideoValidation), aiController.analyzeVideo);
router.post('/transcribe', validate(transcribeValidation), aiController.transcribeAudio);
router.post('/generate-tasks', validate(generateTasksValidation), aiController.generateTasks);
router.post('/rephrase', validate(rephraseValidation), aiController.rephraseContent);

export default router;
