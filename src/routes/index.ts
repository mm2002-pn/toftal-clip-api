import { Router } from 'express';

// Import module routes
import authRoutes from '../modules/auth/routes';
import usersRoutes from '../modules/users/routes';
import projectsRoutes from '../modules/projects/routes';
import deliverablesRoutes from '../modules/deliverables/routes';
import versionsRoutes from '../modules/versions/routes';
import workflowRoutes from '../modules/workflow/routes';
import talentsRoutes from '../modules/talents/routes';
import feedbackRoutes from '../modules/feedback/routes';
import mediaRoutes from '../modules/media/routes';
import aiRoutes from '../modules/ai/routes';
import opportunitiesRoutes from '../modules/opportunities/routes';
import studiosRoutes from '../modules/studios/routes';
import notificationsRoutes from '../modules/notifications/routes';
import analyticsRoutes from '../modules/analytics/routes';

const router = Router();

// API Info
router.get('/', (req, res) => {
  res.json({
    name: 'Toftal Clip API',
    version: '1.0.0',
    description: 'Backend API for Toftal Clip - Video Production Platform',
    endpoints: {
      rest: {
        auth: '/api/v1/auth',
        users: '/api/v1/users',
        projects: '/api/v1/projects',
        deliverables: '/api/v1/deliverables',
        versions: '/api/v1/versions',
        workflow: '/api/v1/workflow',
        talents: '/api/v1/talents',
        feedback: '/api/v1/feedback',
        media: '/api/v1/media',
        ai: '/api/v1/ai',
        opportunities: '/api/v1/opportunities',
        studios: '/api/v1/studios',
        notifications: '/api/v1/notifications',
        analytics: '/api/v1/analytics',
      },
      graphql: '/graphql',
    },
  });
});

// Mount routes
router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/projects', projectsRoutes);
router.use('/deliverables', deliverablesRoutes);
router.use('/versions', versionsRoutes);
router.use('/workflow', workflowRoutes);
router.use('/talents', talentsRoutes);
router.use('/feedback', feedbackRoutes);
router.use('/media', mediaRoutes);
router.use('/ai', aiRoutes);
router.use('/opportunities', opportunitiesRoutes);
router.use('/studios', studiosRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/analytics', analyticsRoutes);

export default router;
