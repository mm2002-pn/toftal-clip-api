/**
 * Subscription routes.
 *
 * /plans is mounted at the API root (router-level) — it's public listing.
 * Everything under /subscriptions/* requires auth.
 *
 * The webhook is wired separately in app.ts because it needs the raw body
 * middleware, not the JSON parser. See app.ts for that route.
 */

import { Router } from 'express';
import { authenticate } from '../../../middlewares/auth';
import {
  listPlans,
  createCheckoutSession,
  getCheckoutStatus,
  getMySubscription,
} from '../controllers';

export const plansRouter = Router();
plansRouter.get('/', listPlans);

const router = Router();
router.use(authenticate);

router.post('/checkout', createCheckoutSession);
router.get('/checkout/:reference/status', getCheckoutStatus);
router.get('/me/:orgId', getMySubscription);

export default router;
